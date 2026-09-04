/**
 * 配置加载与环境解析模块
 */
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { getConfigPaths } from '../utils/paths.js';

const { envPath, configJsonPath, configJsonExamplePath, examplePath } = getConfigPaths();

// 自动初始化 .env
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath);
}

// 自动初始化 config.json
if (!fs.existsSync(configJsonPath) && fs.existsSync(configJsonExamplePath)) {
  fs.copyFileSync(configJsonExamplePath, configJsonPath);
}

dotenv.config({ path: envPath });

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

export function updateEnvFile(filePath, updates) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content.split('\n');
  const existingKeys = new Set();
  const updatedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      updatedLines.push(line);
      continue;
    }
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      existingKeys.add(key);
      if (key in updates) {
        updatedLines.push(`${key}=${updates[key]}`);
      } else {
        updatedLines.push(line);
      }
    } else {
      updatedLines.push(line);
    }
  }

  for (const [key, val] of Object.entries(updates)) {
    if (!existingKeys.has(key)) {
      updatedLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf8');
}

export function getConfigJson() {
  if (!fs.existsSync(configJsonPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

export function saveConfigJson(data) {
  fs.writeFileSync(configJsonPath, JSON.stringify(data, null, 2), 'utf8');
}

let generatedCredentials = null;
let generatedApiKey = null;

function getApiKey() {
  if (process.env.API_KEY) return process.env.API_KEY;
  if (!generatedApiKey) generatedApiKey = 'sk-' + crypto.randomBytes(24).toString('hex');
  return generatedApiKey;
}

function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;
  if (username && password && jwtSecret) {
    return { username, password, jwtSecret };
  }
  if (!generatedCredentials) {
    generatedCredentials = {
      username: username || 'admin',
      password: password || crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, ''),
      jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex')
    };
  }
  return generatedCredentials;
}

export function buildConfig() {
  const jsonCfg = getConfigJson();
  const envCfg = parseEnvFile(envPath);

  const port = Number(process.env.PORT || envCfg.PORT || jsonCfg.server?.port || 8045);
  const host = process.env.HOST || envCfg.HOST || jsonCfg.server?.host || '0.0.0.0';
  
  const sslRaw = process.env.SSL !== undefined ? process.env.SSL : (envCfg.SSL !== undefined ? envCfg.SSL : jsonCfg.server?.ssl);
  const ssl = sslRaw === true || sslRaw === 'true' || sslRaw === '1';

  return {
    server: {
      port,
      host,
      ssl,
      domain: process.env.DOMAIN || envCfg.DOMAIN || jsonCfg.server?.domain || '',
      autoRenewCert: jsonCfg.server?.autoRenewCert !== false,
      maxRequestSize: jsonCfg.server?.maxRequestSize || '50mb',
      heartbeatInterval: jsonCfg.server?.heartbeatInterval || 15000
    },
    admin: getAdminCredentials(),
    security: {
      apiKey: getApiKey()
    },
    proxy: process.env.PROXY || envCfg.PROXY || null,
    timeout: jsonCfg.other?.timeout || 120000,
    log: {
      maxSizeMB: jsonCfg.log?.maxSizeMB || 10,
      maxFiles: jsonCfg.log?.maxFiles || 5,
      maxMemory: jsonCfg.log?.maxMemory || 500
    }
  };
}

let config = buildConfig();

export function reloadConfig() {
  dotenv.config({ path: envPath, override: true });
  config = buildConfig();
  return config;
}

export default config;

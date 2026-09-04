/**
 * API Key 鉴权与使用量统计管理器
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from '../utils/paths.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const KEYS_FILE = 'api_keys.json';

class ApiKeyManager {
  constructor() {
    this.filePath = null;
    this.keys = [];
    this.initialized = false;
    this.savePromise = Promise.resolve();
  }

  async init() {
    if (this.initialized) return;
    this.filePath = path.join(getDataDir(), KEYS_FILE);
    await this.load();
    this.initialized = true;
  }

  async load() {
    try {
      if (fsSync.existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, 'utf8');
        const data = JSON.parse(content);
        this.keys = Array.isArray(data) ? data : (data.keys || []);
      } else {
        // 创建系统默认主 Key
        this.keys = [
          {
            id: 'master_key',
            name: '默认主密钥',
            key: config.security.apiKey,
            role: 'admin',
            enable: true,
            createdAt: Date.now(),
            totalRequests: 0,
            totalTokens: 0,
            modelsUsage: {}
          }
        ];
        await this.save();
      }
    } catch (e) {
      logger.error('加载 API 密钥列表失败:', e.message);
      this.keys = [];
    }
  }

  async save() {
    this.savePromise = this.savePromise.then(async () => {
      try {
        await fs.writeFile(this.filePath, JSON.stringify(this.keys, null, 2), 'utf8');
      } catch (e) {
        logger.error('保存 API 密钥列表失败:', e.message);
      }
    });
    return this.savePromise;
  }

  validateKey(providedKey) {
    if (!providedKey) return { valid: false, keyInfo: null };
    const cleanKey = providedKey.trim();
    // 1. 匹配内存/环境变量默认 Key
    if (cleanKey === config.security.apiKey) {
      return { valid: true, keyInfo: { id: 'master_key', name: '系统主密钥', role: 'admin' } };
    }
    // 2. 匹配已持久化的多 Key
    const found = this.keys.find(k => k.key === cleanKey && k.enable !== false);
    if (found) {
      return { valid: true, keyInfo: found };
    }
    return { valid: false, keyInfo: null };
  }

  async getAllKeys() {
    if (!this.initialized) await this.init();
    return this.keys.map(k => ({
      id: k.id,
      name: k.name,
      key: k.key,
      role: k.role || 'user',
      enable: k.enable !== false,
      totalRequests: k.totalRequests || 0,
      totalTokens: k.totalTokens || 0,
      createdAt: k.createdAt
    }));
  }

  async addKey(data) {
    if (!this.initialized) await this.init();
    const newKey = {
      id: 'key_' + crypto.randomBytes(6).toString('hex'),
      name: data.name || '新建密钥',
      key: data.key || ('sk-' + crypto.randomBytes(24).toString('hex')),
      role: data.role || 'user',
      enable: data.enable ?? true,
      totalRequests: 0,
      totalTokens: 0,
      modelsUsage: {},
      createdAt: Date.now()
    };
    this.keys.push(newKey);
    await this.save();
    return newKey;
  }

  async deleteKey(id) {
    if (!this.initialized) await this.init();
    const index = this.keys.findIndex(k => k.id === id);
    if (index === -1) return false;
    this.keys.splice(index, 1);
    await this.save();
    return true;
  }

  async recordUsage(keyId, usage, model = 'unknown') {
    if (!keyId) return;
    if (!this.initialized) await this.init();
    const keyInfo = this.keys.find(k => k.id === keyId);
    if (!keyInfo) return;

    keyInfo.totalRequests = (keyInfo.totalRequests || 0) + 1;
    const tokens = usage?.total_tokens || ((usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0));
    if (tokens) {
      keyInfo.totalTokens = (keyInfo.totalTokens || 0) + tokens;
    }
    if (!keyInfo.modelsUsage) keyInfo.modelsUsage = {};
    keyInfo.modelsUsage[model] = (keyInfo.modelsUsage[model] || 0) + 1;
    await this.save();
  }
}

const apiKeyManager = new ApiKeyManager();
export default apiKeyManager;

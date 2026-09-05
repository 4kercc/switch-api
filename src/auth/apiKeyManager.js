/**
 * API Key 鉴权与使用量统计管理器 (完整版移植)
 * 支持：
 * - requests / inputTokens / outputTokens / totalTokens 精确统计
 * - 按模型 (models) 维度消耗记录与分析
 * - maxTokens 消耗阈值上限自动熔断拦截
 * - 安全脱敏的公网使用量查询报告 (queryUsageReport)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import { getDataDir } from '../utils/paths.js';

class ApiKeyManager {
  constructor() {
    this.filePath = null;
    this.keys = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.filePath = path.join(getDataDir(), 'api_keys.json');
    this.loadFromFile();
    this.initialized = true;
  }

  loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(content);
        this.keys = Array.isArray(data.keys) ? data.keys : (Array.isArray(data) ? data : []);
      } else {
        this.keys = [];
        this.initializeDefaultKeys();
      }
    } catch (error) {
      logger.error('加载 API 密钥文件失败:', error.message);
      this.keys = [];
    }
  }

  initializeDefaultKeys() {
    const envApiKey = config.security?.apiKey || process.env.API_KEY;
    if (envApiKey) {
      this.keys.push({
        id: 'key_default',
        name: '默认主密钥',
        key: envApiKey,
        enabled: true,
        maxTokens: null,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        usage: {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          models: {}
        }
      });
      this.saveToFile();
    }
  }

  saveToFile() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        meta: { lastUpdated: new Date().toISOString() },
        keys: this.keys
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      logger.error('保存 API 密钥文件失败:', error.message);
    }
  }

  getAllKeys() {
    return this.keys.map(k => ({ ...k }));
  }

  getKeyById(id) {
    return this.keys.find(k => k.id === id) || null;
  }

  validateKey(providedKey) {
    if (this.keys.length === 0) {
      const globalKey = config.security?.apiKey;
      if (!globalKey) return { valid: true, keyInfo: null };
      if (providedKey === globalKey) return { valid: true, keyInfo: { id: 'key_default', name: '默认主密钥' } };
      return { valid: false, keyInfo: null };
    }

    if (!providedKey) {
      const hasEnabledKeys = this.keys.some(k => k.enabled);
      const globalKey = config.security?.apiKey;
      if (!hasEnabledKeys && !globalKey) {
        return { valid: true, keyInfo: null };
      }
      return { valid: false, keyInfo: null };
    }

    const match = this.keys.find(k => k.key === providedKey);
    if (match) {
      if (!match.enabled) {
        return { valid: false, keyInfo: null };
      }

      if (match.maxTokens && match.maxTokens > 0) {
        const currentTotal = match.usage?.totalTokens || 0;
        if (currentTotal >= match.maxTokens) {
          match.enabled = false;
          this.saveToFile();
          logger.warn(`API 密钥 [${match.name}] (ID: ${match.id}) 已达 Token 消耗上限 (${match.maxTokens.toLocaleString()})，自动禁用！`);
          return { valid: false, keyInfo: null };
        }
      }

      return { valid: true, keyInfo: match };
    }

    const globalKey = config.security?.apiKey;
    if (globalKey && providedKey === globalKey) {
      return { valid: true, keyInfo: { id: 'key_default', name: '默认主密钥' } };
    }

    return { valid: false, keyInfo: null };
  }

  createKey({ name, key, maxTokens }) {
    const apiKeyString = key && key.trim() ? key.trim() : ('sk-' + crypto.randomBytes(16).toString('hex'));

    const exists = this.keys.some(k => k.key === apiKeyString);
    if (exists) {
      throw new Error('API 密钥已存在，请勿重复添加相同的密钥');
    }

    const keyId = 'key_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const parsedMaxTokens = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : null;

    const newKey = {
      id: keyId,
      name: name && name.trim() ? name.trim() : 'API Key',
      key: apiKeyString,
      enabled: true,
      maxTokens: parsedMaxTokens,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        models: {}
      }
    };

    this.keys.push(newKey);
    this.saveToFile();
    return newKey;
  }

  updateKey(id, { name, enabled, key, maxTokens }) {
    const target = this.keys.find(k => k.id === id);
    if (!target) return null;

    if (typeof key === 'string' && key.trim() && key.trim() !== target.key) {
      const newKeyString = key.trim();
      const exists = this.keys.some(k => k.id !== id && k.key === newKeyString);
      if (exists) {
        throw new Error('修改后的 API 密钥与现有密钥重复');
      }
      target.key = newKeyString;
    }

    if (typeof name === 'string' && name.trim()) {
      target.name = name.trim();
    }
    if (typeof enabled === 'boolean') {
      target.enabled = enabled;
    }
    if (maxTokens !== undefined) {
      target.maxTokens = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : null;
    }

    this.saveToFile();
    return target;
  }

  deleteKey(id) {
    const index = this.keys.findIndex(k => k.id === id);
    if (index === -1) return false;

    this.keys.splice(index, 1);
    this.saveToFile();
    return true;
  }

  recordUsage(keyId, usage, model = 'unknown') {
    if (!keyId) return;
    const target = this.keys.find(k => k.id === keyId);
    if (!target) return;

    const inputTokens = Number(usage?.prompt_tokens || usage?.input_tokens || usage?.promptTokenCount || 0);
    const outputTokens = Number(usage?.completion_tokens || usage?.output_tokens || usage?.candidatesTokenCount || 0);
    const totalTokens = Number(usage?.total_tokens || usage?.totalTokenCount || (inputTokens + outputTokens));

    if (!target.usage) {
      target.usage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, models: {} };
    }
    if (!target.usage.models) {
      target.usage.models = {};
    }

    target.usage.requests = (target.usage.requests || 0) + 1;
    target.usage.inputTokens = (target.usage.inputTokens || 0) + inputTokens;
    target.usage.outputTokens = (target.usage.outputTokens || 0) + outputTokens;
    target.usage.totalTokens = (target.usage.totalTokens || 0) + totalTokens;
    target.lastUsedAt = new Date().toISOString();

    const modelKey = String(model || 'unknown').trim();
    if (!target.usage.models[modelKey]) {
      target.usage.models[modelKey] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        lastUsedAt: null
      };
    }
    const m = target.usage.models[modelKey];
    m.requests += 1;
    m.inputTokens += inputTokens;
    m.outputTokens += outputTokens;
    m.totalTokens += totalTokens;
    m.lastUsedAt = target.lastUsedAt;

    if (target.maxTokens && target.maxTokens > 0 && target.usage.totalTokens >= target.maxTokens) {
      target.enabled = false;
      logger.warn(`API 密钥 [${target.name}] (ID: ${target.id}) 累计 Token 已达上限 (${target.usage.totalTokens.toLocaleString()} / ${target.maxTokens.toLocaleString()})，自动禁用！`);
    }

    this.saveToFile();
  }

  queryUsageReport(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    const cleanKey = rawKey.trim();
    const target = this.keys.find(k => k.key === cleanKey);
    if (!target) return null;

    const totalTokens = target.usage?.totalTokens || 0;
    const inputTokens = target.usage?.inputTokens || 0;
    const outputTokens = target.usage?.outputTokens || 0;
    const requests = target.usage?.requests || 0;
    const maxTokens = target.maxTokens || 0;

    let isExceeded = false;
    let percentage = 0;
    if (maxTokens > 0) {
      percentage = Math.min(100, Math.round((totalTokens / maxTokens) * 1000) / 10);
      if (totalTokens >= maxTokens) {
        isExceeded = true;
      }
    }

    const modelsData = [];
    if (target.usage?.models) {
      Object.entries(target.usage.models).forEach(([modelName, stats]) => {
        const modelTotal = stats.totalTokens || 0;
        const modelPct = totalTokens > 0 ? ((modelTotal / totalTokens) * 100).toFixed(1) : '0.0';
        modelsData.push({
          name: modelName,
          requests: stats.requests || 0,
          inputTokens: stats.inputTokens || 0,
          outputTokens: stats.outputTokens || 0,
          totalTokens: modelTotal,
          percentage: modelPct,
          lastUsedAt: stats.lastUsedAt
        });
      });
    }

    modelsData.sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      name: target.name,
      maskedKey: target.key.length > 10 ? (target.key.substring(0, 6) + '...' + target.key.substring(target.key.length - 4)) : '••••••••',
      enabled: target.enabled,
      isExceeded,
      maxTokens,
      totalTokens,
      inputTokens,
      outputTokens,
      requests,
      percentage,
      createdAt: target.createdAt,
      lastUsedAt: target.lastUsedAt,
      models: modelsData
    };
  }

  getOverallStats() {
    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;

    this.keys.forEach(k => {
      if (k.usage) {
        totalRequests += k.usage.requests || 0;
        totalInputTokens += k.usage.inputTokens || 0;
        totalOutputTokens += k.usage.outputTokens || 0;
        totalTokens += k.usage.totalTokens || 0;
      }
    });

    return {
      totalKeys: this.keys.length,
      enabledKeys: this.keys.filter(k => k.enabled).length,
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalTokens
    };
  }
}

const apiKeyManager = new ApiKeyManager();
export default apiKeyManager;

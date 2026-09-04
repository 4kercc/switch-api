/**
 * 外部上游渠道管理器 (支持全动态路径分流与默认模型降级)
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from './paths.js';
import logger from './logger.js';

const CHANNELS_FILE = 'channels.json';

class ChannelManager {
  constructor() {
    this.filePath = null;
    this.channels = [];
    this.initialized = false;
    this.savePromise = Promise.resolve();
    this.channelUsageIndices = new Map();
    this.pathUsageIndices = new Map();
  }

  _cleanBaseUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
  }

  _cleanPathPrefix(prefix) {
    if (!prefix || typeof prefix !== 'string') return '';
    let p = prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p) return '';
    p = p.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!p) return '';
    
    // 系统保留路径
    const RESERVED = ['admin', 'v1', 'v1beta', 'cli', 'sdapi', 'images', 'api', 'health', 'ws'];
    if (RESERVED.includes(p.toLowerCase())) {
      return '';
    }
    return `/${p}`;
  }

  async init() {
    if (this.initialized) return;
    const dataDir = getDataDir();
    this.filePath = path.join(dataDir, CHANNELS_FILE);
    await this.load();
    this.initialized = true;
  }

  async load() {
    try {
      if (fsSync.existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, 'utf8');
        const data = JSON.parse(content);
        this.channels = Array.isArray(data) ? data : (data.channels || []);
      } else {
        this.channels = [];
      }
    } catch (e) {
      logger.error('加载外部渠道列表失败:', e.message);
      this.channels = [];
    }
  }

  async save() {
    this.savePromise = this.savePromise.then(async () => {
      try {
        await fs.writeFile(this.filePath, JSON.stringify(this.channels, null, 2), 'utf8');
      } catch (e) {
        logger.error('保存外部渠道配置失败:', e.message);
      }
    });
    return this.savePromise;
  }

  async getChannels() {
    if (!this.initialized) await this.init();
    return this.channels.map(c => {
      let maskedKey = '';
      if (c.apiKey && typeof c.apiKey === 'string') {
        maskedKey = c.apiKey.length > 8 
          ? `${c.apiKey.substring(0, 4)}...${c.apiKey.substring(c.apiKey.length - 4)}` 
          : '******';
      }
      return {
        ...c,
        pathPrefix: c.pathPrefix || '',
        defaultModel: c.defaultModel || '',
        apiKeyMasked: maskedKey,
        hasKey: !!c.apiKey
      };
    });
  }

  async getChannelById(id) {
    if (!this.initialized) await this.init();
    return this.channels.find(c => c.id === id);
  }

  async addChannel(channelData) {
    if (!this.initialized) await this.init();

    const newChannel = {
      id: 'chan_' + crypto.randomBytes(6).toString('hex'),
      name: channelData.name || '外部渠道',
      type: channelData.type || 'openai',
      baseUrl: this._cleanBaseUrl(channelData.baseUrl),
      pathPrefix: this._cleanPathPrefix(channelData.pathPrefix),
      apiKey: channelData.apiKey || '',
      models: Array.isArray(channelData.models) ? channelData.models : (channelData.models ? channelData.models.split(',').map(m => m.trim()).filter(Boolean) : []),
      defaultModel: (channelData.defaultModel || '').trim(),
      enable: channelData.enable ?? true,
      priority: Number(channelData.priority) || 10,
      weight: Number(channelData.weight) || 1,
      totalRequests: 0,
      totalTokens: 0,
      createdAt: Date.now()
    };

    this.channels.push(newChannel);
    await this.save();
    logger.info(`✓ 已添加外部渠道: ${newChannel.name} (BaseURL: ${newChannel.baseUrl}, 分流路径: ${newChannel.pathPrefix || '无'}, 默认模型: ${newChannel.defaultModel || '无'})`);
    return newChannel;
  }

  async updateChannel(id, updates) {
    if (!this.initialized) await this.init();
    const index = this.channels.findIndex(c => c.id === id);
    if (index === -1) return null;

    const oldChannel = this.channels[index];
    const updatedChannel = {
      ...oldChannel,
      name: updates.name ?? oldChannel.name,
      type: updates.type ?? oldChannel.type,
      baseUrl: updates.baseUrl !== undefined ? this._cleanBaseUrl(updates.baseUrl) : oldChannel.baseUrl,
      pathPrefix: updates.pathPrefix !== undefined ? this._cleanPathPrefix(updates.pathPrefix) : (oldChannel.pathPrefix || ''),
      apiKey: updates.apiKey !== undefined ? updates.apiKey : oldChannel.apiKey,
      models: updates.models !== undefined 
        ? (Array.isArray(updates.models) ? updates.models : updates.models.split(',').map(m => m.trim()).filter(Boolean))
        : oldChannel.models,
      defaultModel: updates.defaultModel !== undefined ? (updates.defaultModel || '').trim() : (oldChannel.defaultModel || ''),
      enable: updates.enable ?? oldChannel.enable,
      priority: updates.priority !== undefined ? Number(updates.priority) : oldChannel.priority,
      weight: updates.weight !== undefined ? Number(updates.weight) : oldChannel.weight,
      updatedAt: Date.now()
    };

    this.channels[index] = updatedChannel;
    await this.save();
    logger.info(`✓ 已更新外部渠道: ${updatedChannel.name} (BaseURL: ${updatedChannel.baseUrl}, 分流路径: ${updatedChannel.pathPrefix || '无'}, 默认模型: ${updatedChannel.defaultModel || '无'})`);
    return updatedChannel;
  }

  async deleteChannel(id) {
    if (!this.initialized) await this.init();
    const index = this.channels.findIndex(c => c.id === id);
    if (index === -1) return false;

    const [deleted] = this.channels.splice(index, 1);
    await this.save();
    logger.info(`✓ 已删除外部渠道: ${deleted.name}`);
    return true;
  }

  async recordUsage(id, usage = null) {
    if (!id) return;
    if (!this.initialized) await this.init();
    const chan = this.channels.find(c => c.id === id);
    if (!chan) return;

    chan.totalRequests = (chan.totalRequests || 0) + 1;
    if (usage) {
      const input = usage.prompt_tokens || usage.input_tokens || 0;
      const output = usage.completion_tokens || usage.output_tokens || 0;
      const total = usage.total_tokens || (input + output);
      chan.totalTokens = (chan.totalTokens || 0) + total;
    }
    chan.lastUsed = Date.now();
    await this.save();
  }

  isModelSupported(channel, model) {
    if (!channel) return false;
    if (!channel.models || channel.models.length === 0) return true;
    if (!model) return true;
    const lowerModel = model.toLowerCase().trim();
    return channel.models.some(m => {
      const lm = (m || '').toLowerCase().trim();
      return lm === '*' || lm === lowerModel;
    });
  }

  resolveModelForChannel(channel, model) {
    if (!channel || !model) return { targetModel: model, isDowngraded: false, originalModel: model };
    
    if (this.isModelSupported(channel, model)) {
      return { targetModel: model, isDowngraded: false, originalModel: model };
    }

    if (channel.defaultModel) {
      return { targetModel: channel.defaultModel, isDowngraded: true, originalModel: model };
    }

    return { targetModel: model, isDowngraded: false, originalModel: model };
  }

  async getAvailableChannelsForModel(model) {
    if (!this.initialized) await this.init();

    return this.channels.filter(c => {
      if (!c.enable) return false;
      return this.isModelSupported(c, model) || !!c.defaultModel;
    }).sort((a, b) => (a.priority || 10) - (b.priority || 10));
  }

  async getChannel(model) {
    const availableChannels = await this.getAvailableChannelsForModel(model);
    if (availableChannels.length === 0) return null;

    const idx = this.channelUsageIndices.get(model || 'any') || 0;
    const selected = availableChannels[idx % availableChannels.length];
    this.channelUsageIndices.set(model || 'any', (idx + 1) % availableChannels.length);
    return selected;
  }

  async getChannelByPathPrefix(pathPrefix, model = null) {
    if (!pathPrefix) return null;
    if (!this.initialized) await this.init();

    const cleanPrefix = this._cleanPathPrefix(pathPrefix);
    if (!cleanPrefix) return null;

    const matchedChannels = this.channels.filter(c => {
      if (!c.enable) return false;
      if (!c.pathPrefix) return false;
      return this._cleanPathPrefix(c.pathPrefix) === cleanPrefix;
    });

    if (matchedChannels.length === 0) return null;

    let candidateChannels = matchedChannels;
    if (model) {
      const modelMatched = matchedChannels.filter(c => {
        return this.isModelSupported(c, model) || !!c.defaultModel;
      });
      if (modelMatched.length > 0) {
        candidateChannels = modelMatched;
      }
    }

    candidateChannels.sort((a, b) => (a.priority || 10) - (b.priority || 10));

    const key = `${cleanPrefix}:${model || 'any'}`;
    const idx = this.pathUsageIndices.get(key) || 0;
    const selected = candidateChannels[idx % candidateChannels.length];
    this.pathUsageIndices.set(key, (idx + 1) % candidateChannels.length);
    return selected;
  }

  async getAllConfiguredPathPrefixes() {
    if (!this.initialized) await this.init();
    const prefixes = new Set();
    for (const c of this.channels) {
      if (c.pathPrefix) {
        const clean = this._cleanPathPrefix(c.pathPrefix);
        if (clean) prefixes.add(clean);
      }
    }
    return Array.from(prefixes);
  }

  async isRecognizedPathPrefix(pathPrefix) {
    if (!pathPrefix) return false;
    const clean = this._cleanPathPrefix(pathPrefix);
    if (!clean) return false;
    if (/^\/v\d+$/.test(clean)) return true;
    const all = await this.getAllConfiguredPathPrefixes();
    return all.includes(clean);
  }
}

const channelManager = new ChannelManager();
export default channelManager;

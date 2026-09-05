/**
 * IP 封禁与安全风控管理器
 * 规则：
 * 1. 连续 30 次出现 404 / 502 / 登录失败 / 鉴权失败 等，自动将 IP 临时封禁 60 分钟；
 * 2. 连续 3 次触发临时封禁，自动将 IP 升级加入永久黑名单；
 * 3. 支持系统设置中手动封禁、解封、白名单与安全阈值配置。
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getDataDir } from './paths.js';
import logger from './logger.js';

const BLOCKLIST_FILE = 'ip-blocklist.json';

const DEFAULT_CONFIG = {
  whitelist: {
    enabled: true,
    ips: ['127.0.0.1', '::1', 'localhost']
  },
  blocking: {
    enabled: true,
    tempBlockDuration: 60 * 60 * 1000,        // 封禁 60 分钟 (3600000ms)
    maxViolationsBeforeTempBlock: 30,          // 连续 30 次失败触发临时封禁
    maxTempBlocksBeforePermanent: 3,           // 连续 3 次临时封禁自动转为永久黑名单
    violationWindow: 15 * 60 * 1000,           // 违规时间窗口 15 分钟
    violationDecayTime: 30 * 60 * 1000         // 衰减时间
  }
};

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fe80:/,
  /^fc00:/,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:192\.168\./
];

class IpBlockManager {
  constructor() {
    this.filePath = null;
    this.data = { blocked_ips: {} };
    this.config = DEFAULT_CONFIG;
    this.initialized = false;
    this.savePromise = Promise.resolve();
  }

  async init() {
    if (this.initialized) return;
    const dataDir = getDataDir();
    this.filePath = path.join(dataDir, BLOCKLIST_FILE);
    await this.load();
    this.initialized = true;
  }

  isWhitelisted(ip) {
    if (!ip) return false;
    if (!this.config.whitelist.enabled) return false;
    if (this.config.whitelist.ips.includes(ip)) return true;
    return PRIVATE_IP_RANGES.some(regex => regex.test(ip));
  }

  async load() {
    try {
      if (fsSync.existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(content);
        this.data = parsed.blocked_ips ? parsed : { blocked_ips: parsed };
      } else {
        this.data = { blocked_ips: {} };
        await this.save();
      }
    } catch (e) {
      logger.error('加载 IP 封禁列表失败:', e.message);
      this.data = { blocked_ips: {} };
    }
  }

  async save() {
    this.savePromise = this.savePromise.then(async () => {
      try {
        await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (e) {
        logger.error('保存 IP 封禁列表失败:', e.message);
      }
    });
    return this.savePromise;
  }

  check(ip) {
    if (!ip || this.isWhitelisted(ip)) return { blocked: false };
    if (!this.config.blocking.enabled) return { blocked: false };

    const info = this.data.blocked_ips[ip];
    if (!info) return { blocked: false };

    if (info.permanent) {
      return { blocked: true, reason: 'permanent' };
    }

    if (info.expiresAt && Date.now() < info.expiresAt) {
      return { blocked: true, reason: 'temporary', expiresAt: info.expiresAt };
    }

    return { blocked: false };
  }

  async recordViolation(ip, type = 'error', severityWeight = 1) {
    if (!ip || this.isWhitelisted(ip)) return;
    if (!this.config.blocking.enabled) return;

    if (!this.initialized) await this.init();

    let info = this.data.blocked_ips[ip];
    const now = Date.now();

    if (!info) {
      info = {
        permanent: false,
        expiresAt: 0,
        violations: 0,
        tempBlockCount: 0,
        lastViolation: 0,
        reasons: []
      };
      this.data.blocked_ips[ip] = info;
    }

    if (info.permanent) return;

    // 如果当前正在临时封禁中，但又发生了新的违规，跳过或允许记录
    if (info.expiresAt && now < info.expiresAt && (info.violations === 0)) return;

    const { violationDecayTime, violationWindow, maxViolationsBeforeTempBlock, maxTempBlocksBeforePermanent, tempBlockDuration } = this.config.blocking;

    if (info.expiresAt && now >= info.expiresAt) {
      // 封禁时间已过，重置封禁到期时间，继续统计下一轮
      info.expiresAt = 0;
    }

    if (now - info.lastViolation > violationDecayTime) {
      info.violations = Math.max(0, Math.floor(info.violations / 2));
    } else if (now - info.lastViolation > violationWindow) {
      info.violations = 0;
    }

    info.violations += (typeof severityWeight === 'number' && severityWeight > 0) ? severityWeight : 1;
    info.lastViolation = now;

    if (!info.reasons) info.reasons = [];
    if (!info.reasons.includes(type)) {
      info.reasons.push(type);
      if (info.reasons.length > 5) info.reasons.shift();
    }

    if (info.violations >= maxViolationsBeforeTempBlock) {
      info.tempBlockCount = (info.tempBlockCount || 0) + 1;
      info.violations = 0;

      if (info.tempBlockCount >= maxTempBlocksBeforePermanent) {
        info.permanent = true;
        info.expiresAt = 0;
        logger.warn(`🚨 IP [${ip}] 连续触发 ${info.tempBlockCount} 次违规拦截，已自动加入永久黑名单！`);
      } else {
        info.expiresAt = now + tempBlockDuration;
        const minutes = Math.round(tempBlockDuration / 60000);
        logger.warn(`⚠️ IP [${ip}] 因连续出现异常(${type})达 ${maxViolationsBeforeTempBlock} 次，已被自动封禁 ${minutes} 分钟 (累计封禁 ${info.tempBlockCount} 次)！`);
      }

      await this.save();
    }
  }

  async blockIP(ip, permanent = true, durationMs = null) {
    if (!ip) return false;
    if (!this.initialized) await this.init();

    const cleanIp = String(ip).trim();
    const now = Date.now();
    const tempDuration = durationMs || this.config.blocking.tempBlockDuration || 3600000;

    this.data.blocked_ips[cleanIp] = {
      permanent: permanent,
      expiresAt: permanent ? 0 : (now + tempDuration),
      violations: 999,
      tempBlockCount: permanent ? 3 : 1,
      lastViolation: now,
      manual: true
    };

    await this.save();
    logger.warn(`🛡️ 管理员手动将 IP [${cleanIp}] 加入${permanent ? '永久黑名单' : `临时封禁 (${Math.round(tempDuration/60000)}分钟)`}`);
    return true;
  }

  async unblock(ip) {
    if (!ip) return false;
    if (!this.initialized) await this.init();

    const cleanIp = String(ip).trim();
    if (this.data.blocked_ips[cleanIp]) {
      delete this.data.blocked_ips[cleanIp];
      await this.save();
      logger.info(`✓ IP [${cleanIp}] 已成功解除封禁与黑名单`);
      return true;
    }
    return false;
  }

  async listBlocked() {
    if (!this.initialized) await this.init();
    const now = Date.now();
    return Object.entries(this.data.blocked_ips)
      .filter(([_, info]) => {
        return info.permanent || (info.expiresAt && now < info.expiresAt);
      })
      .map(([ip, info]) => ({
        ip,
        permanent: info.permanent,
        expiresAt: info.expiresAt,
        tempBlockCount: info.tempBlockCount || 0,
        reasons: info.reasons || [],
        manual: !!info.manual
      }));
  }

  getConfig() {
    return this.config;
  }

  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      whitelist: { ...this.config.whitelist, ...(newConfig.whitelist || {}) },
      blocking: { ...this.config.blocking, ...(newConfig.blocking || {}) }
    };
  }
}

const ipBlockManager = new IpBlockManager();
export default ipBlockManager;

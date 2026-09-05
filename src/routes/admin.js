/**
 * 后台管理 API 路由
 */
import express from 'express';
import config, { reloadConfig, parseEnvFile, updateEnvFile, getConfigJson, saveConfigJson } from '../config/config.js';
import { getConfigPaths } from '../utils/paths.js';
import { generateToken, verifyToken, verifyPassword } from '../auth/auth.js';
import apiKeyManager from '../auth/apiKeyManager.js';
import channelManager from '../utils/channelManager.js';
import ipBlockManager from '../utils/ipBlockManager.js';
import { testExternalChannel } from '../api/externalChannelClient.js';
import { getCertificateInfo, issueAcmeCert, generateSelfSignedCert } from '../utils/cert.js';
import logger from '../utils/logger.js';
import { server } from '../server/index.js';

const router = express.Router();
const { envPath } = getConfigPaths();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

export const cookieAuthMiddleware = (req, res, next) => {
  let token = req.cookies?.authToken;
  if (!token) {
    const authHeader = req.headers.authorization;
    token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.clearCookie('authToken', COOKIE_OPTIONS);
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  req.user = decoded;
  next();
};

// ==================== 认证相关 ====================

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const clientIP = req.clientIP || req.ip || 'unknown';

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码必填' });
  }

  if (username === config.admin.username && password === config.admin.password) {
    const token = generateToken({ username, role: 'admin' });
    res.cookie('authToken', token, {
      ...COOKIE_OPTIONS,
      secure: req.secure || false
    });
    return res.json({ success: true, token, message: '登录成功' });
  }

  // 登录失败记录安全违规（加权 5 分，6次失败即可临时封禁）
  await ipBlockManager.recordViolation(clientIP, 'login_fail', 5);
  return res.status(401).json({ success: false, message: '用户名或密码错误' });
});

router.post('/logout', (req, res) => {
  res.clearCookie('authToken', COOKIE_OPTIONS);
  res.json({ success: true, message: '已退出登录' });
});

router.get('/auth/status', (req, res) => {
  let token = req.cookies?.authToken;
  if (!token) {
    const authHeader = req.headers.authorization;
    token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  }
  const decoded = token ? verifyToken(token) : null;
  res.json({ success: !!decoded, user: decoded });
});

// ==================== 仪表盘数据与实时日志 ====================

router.get('/stats', cookieAuthMiddleware, async (req, res) => {
  const channels = await channelManager.getChannels();
  const keys = await apiKeyManager.getAllKeys();
  const memoryUsage = process.memoryUsage();

  let totalRequests = 0;
  let totalTokens = 0;
  for (const c of channels) {
    totalRequests += (c.totalRequests || 0);
    totalTokens += (c.totalTokens || 0);
  }

  res.json({
    success: true,
    data: {
      uptime: Math.floor(process.uptime()),
      channelsCount: channels.length,
      activeChannelsCount: channels.filter(c => c.enable !== false).length,
      keysCount: keys.length,
      totalRequests,
      totalTokens,
      memory: {
        rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024)
      }
    }
  });
});

router.get('/logs', cookieAuthMiddleware, (req, res) => {
  res.json({ success: true, data: logger.getLogs() });
});

router.delete('/logs', cookieAuthMiddleware, (req, res) => {
  logger.clearLogs();
  res.json({ success: true, message: '已清空内存日志' });
});

// ==================== 渠道管理 ====================

router.get('/channels', cookieAuthMiddleware, async (req, res) => {
  const list = await channelManager.getChannels();
  res.json({ success: true, data: list });
});

router.post('/channels', cookieAuthMiddleware, async (req, res) => {
  const { name, baseUrl, apiKey, models, defaultModel, enable, priority, type, pathPrefix } = req.body || {};
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: '渠道 Base URL 必填' });
  }
  const chan = await channelManager.addChannel({ name, baseUrl, apiKey, models, defaultModel, enable, priority, type, pathPrefix });
  res.json({ success: true, message: `渠道 [${chan.name}] 添加成功`, data: chan });
});

router.put('/channels/:id', cookieAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const updated = await channelManager.updateChannel(id, req.body || {});
  if (!updated) return res.status(404).json({ success: false, message: '渠道不存在' });
  res.json({ success: true, message: '渠���配置更新成功', data: updated });
});

router.delete('/channels/:id', cookieAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const ok = await channelManager.deleteChannel(id);
  if (!ok) return res.status(404).json({ success: false, message: '渠道不存在' });
  res.json({ success: true, message: '渠道已删除' });
});

router.post('/channels/:id/test', cookieAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const { model } = req.body || {};
  const chan = await channelManager.getChannelById(id);
  if (!chan) return res.status(404).json({ success: false, message: '渠道不存在' });

  try {
    const result = await testExternalChannel(chan, model);
    res.json({ success: true, message: `连接测试通过！延迟: ${result.latencyMs}ms`, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: `连接失败: ${e.message}` });
  }
});

// ==================== API Key 管理 (完整移植) ====================

// 获取所有 API Key 及其统计概览
router.get('/api-keys', cookieAuthMiddleware, async (req, res) => {
  try {
    const keys = apiKeyManager.getAllKeys();
    const stats = apiKeyManager.getOverallStats();
    res.json({ success: true, data: { keys, stats } });
  } catch (error) {
    logger.error('获取 API 密钥列表失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 新建 API Key (支持自定义 Key 与 maxTokens 阈值)
router.post('/api-keys', cookieAuthMiddleware, async (req, res) => {
  try {
    const { name, key, maxTokens } = req.body || {};
    const newKey = apiKeyManager.createKey({ name, key, maxTokens });
    logger.info(`✓ 创建新 API 密钥: ${newKey.name} (${newKey.id}), maxTokens=${newKey.maxTokens || '无限制'}`);
    res.json({ success: true, data: newKey, message: '创建 API 密钥成功' });
  } catch (error) {
    logger.error('创建 API 密钥失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更新 API Key (修改名称 / 启用开关 / Key 字符串 / maxTokens 阈值)
router.put('/api-keys/:id', cookieAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled, key, maxTokens } = req.body || {};
    const updated = apiKeyManager.updateKey(id, { name, enabled, key, maxTokens });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'API 密钥不存在' });
    }
    logger.info(`✓ 更新 API 密钥 (${id}): ${updated.name}, enabled=${updated.enabled}, maxTokens=${updated.maxTokens || '无限制'}`);
    res.json({ success: true, data: updated, message: '更新成功' });
  } catch (error) {
    logger.error('更新 API 密钥失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除 API Key
router.delete('/api-keys/:id', cookieAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const ok = apiKeyManager.deleteKey(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'API 密钥不存在' });
    }
    logger.info(`✓ 删除 API 密钥 (${id})`);
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    logger.error('删除 API 密钥失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 兼容旧接口
router.get('/keys', cookieAuthMiddleware, (req, res) => {
  res.json({ success: true, data: apiKeyManager.getAllKeys() });
});

// ==================== 系统设置 ====================

router.get('/config', cookieAuthMiddleware, (req, res) => {
  const envData = parseEnvFile(envPath);
  const jsonData = getConfigJson();
  res.json({ success: true, data: { env: envData, json: jsonData, current: config } });
});

router.put('/config', cookieAuthMiddleware, (req, res) => {
  const { env: envUpdates, json: jsonUpdates } = req.body || {};
  if (envUpdates) updateEnvFile(envPath, envUpdates);
  if (jsonUpdates) {
    const currentJson = getConfigJson();
    saveConfigJson({ ...currentJson, ...jsonUpdates });
  }
  reloadConfig();
  res.json({ success: true, message: '配置已更新并生效（端口修改需重启服务）' });
});

// 证书申请与续期
router.get('/cert/status', cookieAuthMiddleware, (req, res) => {
  res.json({ success: true, data: getCertificateInfo() });
});

router.post('/cert/issue', cookieAuthMiddleware, async (req, res) => {
  const { domain } = req.body || {};
  if (!domain) return res.status(400).json({ success: false, message: '请输入要绑定的域名' });
  try {
    await issueAcmeCert(domain);
    if (server && server.reloadSSLContext) server.reloadSSLContext();
    res.json({ success: true, message: `域名 ${domain} 的 SSL 证书签发成功！` });
  } catch (e) {
    res.status(500).json({ success: false, message: `证书签发失败: ${e.message}` });
  }
});

// ==================== IP 封禁与黑名单管理 API ====================

// 获取所有被封禁/拉黑的 IP 列表
router.get('/security/blocked-ips', cookieAuthMiddleware, async (req, res) => {
  try {
    const list = await ipBlockManager.listBlocked();
    res.json({ success: true, data: list });
  } catch (error) {
    logger.error('获取封禁 IP 列表失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 手动将 IP 加入黑名单/封禁
router.post('/security/block-ip', cookieAuthMiddleware, async (req, res) => {
  try {
    const { ip, permanent = true, durationMs } = req.body || {};
    if (!ip) return res.status(400).json({ success: false, message: 'IP 地址不能为空' });

    const ok = await ipBlockManager.blockIP(ip, permanent, durationMs);
    res.json({ success: ok, message: `IP [${ip}] 已成功加入${permanent ? '永久黑名单' : '封禁列表'}` });
  } catch (error) {
    logger.error('手动封禁 IP 失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 解除指定 IP 的封禁/黑名单
router.post('/security/unblock-ip', cookieAuthMiddleware, async (req, res) => {
  try {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ success: false, message: 'IP 地址不能为空' });

    const ok = await ipBlockManager.unblock(ip);
    if (ok) {
      res.json({ success: true, message: `IP [${ip}] 已解除封禁` });
    } else {
      res.status(404).json({ success: false, message: '该 IP 不在封禁列表中' });
    }
  } catch (error) {
    logger.error('解除封禁失败:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

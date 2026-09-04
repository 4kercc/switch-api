/**
 * API 聚合与全动态多渠道分流网关主服务
 */
import express from 'express';
import http from 'http';
import https from 'https';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';

import config from '../config/config.js';
import { getPublicDir } from '../utils/paths.js';
import logger from '../utils/logger.js';
import apiKeyManager from '../auth/apiKeyManager.js';
import channelManager from '../utils/channelManager.js';
import adminRouter from '../routes/admin.js';
import { handleOpenAIRequest } from './handlers/openai.js';
import { handleClaudeRequest } from './handlers/claude.js';
import { handleGeminiRequest } from './handlers/gemini.js';
import { getCertPaths, certsExist, generateSelfSignedCert } from '../utils/cert.js';

const app = express();
const publicDir = getPublicDir();

app.disable('x-powered-by');

// 基础中间件
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: config.server.maxRequestSize }));
app.use(express.static(publicDir));

// 获取客户端真实 IP
function getRealClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    if (ips.length > 0 && ips[0]) return ips[0];
  }
  let ip = req.socket?.remoteAddress || req.ip || 'unknown';
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}

// 访问日志中间件
app.use((req, res, next) => {
  const ignore = ['/favicon.ico', '/ws/logs'];
  const fullPath = req.originalUrl.split('?')[0];
  if (!ignore.some(p => fullPath.startsWith(p))) {
    const start = Date.now();
    res.on('finish', () => {
      const clientIp = getRealClientIP(req);
      logger.request(req.method, fullPath, res.statusCode, Date.now() - start, clientIp, res.locals.tokenUsage, res.locals.channelName, res.locals.model);
    });
  }
  next();
});

// ==================== 管理后台路由 ====================
app.use('/admin', adminRouter);

// ==================== 动态本地分流识别中间件 ====================
const RESERVED_ROUTE_ROOTS = new Set([
  'admin', 'v1', 'v1beta', 'api', 'health', 'ws', 'favicon.ico', 'robots.txt'
]);

app.use(async (req, res, next) => {
  const match = req.path.match(/^\/([a-zA-Z0-9_-]+)(\/.*)?$/);
  if (match) {
    const rootSeg = match[1];
    const pathPrefix = `/${rootSeg}`;
    if (!RESERVED_ROUTE_ROOTS.has(rootSeg)) {
      const isRecognized = await channelManager.isRecognizedPathPrefix(pathPrefix);
      if (isRecognized) {
        res.locals.isChannelRoute = true;
        res.locals.pathPrefix = pathPrefix;
        const targetChannel = await channelManager.getChannelByPathPrefix(pathPrefix, req.body?.model || null);
        if (targetChannel) {
          res.locals.targetChannel = targetChannel;
        } else {
          res.locals.unmatchedPathPrefix = pathPrefix;
        }
      }
    }
  }
  next();
});

// ==================== API Key 鉴权中间件 ====================
app.use(async (req, res, next) => {
  let providedKey = null;

  const isStandardApiPath = /^\/(v1|v1beta)\//.test(req.path) || req.path === '/v1beta';
  const isApiPath = isStandardApiPath || res.locals.isChannelRoute;

  if (isApiPath) {
    if (req.path.startsWith('/v1beta')) {
      providedKey = req.query.key || req.headers['x-goog-api-key'];
    } else {
      const authHeader = req.headers.authorization || req.headers['x-api-key'];
      providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    }
  } else {
    return next();
  }

  const { valid, keyInfo } = apiKeyManager.validateKey(providedKey);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  req.apiKeyInfo = keyInfo;

  res.on('finish', () => {
    if (res.locals.tokenUsage && req.apiKeyInfo?.id) {
      apiKeyManager.recordUsage(req.apiKeyInfo.id, res.locals.tokenUsage, res.locals.model || 'unknown');
    }
  });

  next();
});

// ==================== 路由器定义 ====================

const openaiRouter = express.Router();
openaiRouter.post('/chat/completions', handleOpenAIRequest);
openaiRouter.get('/models', async (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'gpt-4o', object: 'model' },
      { id: 'gpt-5', object: 'model' },
      { id: 'claude-3-7-sonnet', object: 'model' },
      { id: 'gemini-2.5-pro', object: 'model' }
    ]
  });
});

const claudeRouter = express.Router();
claudeRouter.post('/messages', (req, res) => handleClaudeRequest(req, res, req.body?.stream === true));

const geminiRouter = express.Router();
geminiRouter.post('/models/:model', (req, res) => handleGeminiRequest(req, res, false));
geminiRouter.post('/models/:model\\:streamGenerateContent', (req, res) => handleGeminiRequest(req, res, true));
geminiRouter.post('/models/:model\\:generateContent', (req, res) => handleGeminiRequest(req, res, false));

const dynamicChannelRouterWrapper = (router) => (req, res, next) => {
  if (res.locals.isChannelRoute) {
    return router(req, res, next);
  }
  next();
};

const DYNAMIC_CHANNEL_ROUTE_REGEX = /^\/([a-zA-Z0-9_-]+)/;

// 挂载 API
app.use('/v1', openaiRouter);
app.use(DYNAMIC_CHANNEL_ROUTE_REGEX, dynamicChannelRouterWrapper(openaiRouter));

app.use('/v1', claudeRouter);
app.use(DYNAMIC_CHANNEL_ROUTE_REGEX, dynamicChannelRouterWrapper(claudeRouter));

app.use('/v1beta', geminiRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), service: 'api-gateway-allin' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// ==================== 启动服务器 ====================
let server;
const certPaths = getCertPaths();

if (!certsExist()) {
  try {
    generateSelfSignedCert('127.0.0.1');
  } catch (err) {}
}

const useSSL = config.server.ssl !== false && certsExist();

if (useSSL) {
  try {
    const sslOptions = {
      cert: fs.readFileSync(certPaths.certPath),
      key: fs.readFileSync(certPaths.keyPath)
    };
    server = https.createServer(sslOptions, app);
    server.reloadSSLContext = () => {
      try {
        const certData = fs.readFileSync(certPaths.certPath);
        const keyData = fs.readFileSync(certPaths.keyPath);
        const newContext = tls.createSecureContext({ cert: certData, key: keyData });
        server.setSecureContext(newContext);
        logger.info('HTTPS SSL 证书上下文已重载');
      } catch (e) {
        logger.error('SSL 重载失败:', e.message);
      }
    };
    logger.info('已开启 HTTPS 原生加密传输');
  } catch (err) {
    logger.error('加载 SSL 失败，降级为 HTTP:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

// WebSocket 实时日志
const wss = new WebSocketServer({ server, path: '/ws/logs' });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

logger.setWsBroadcast((logItem) => {
  const msg = JSON.stringify(logItem);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch (e) {}
    }
  }
});

// 导出 server
export { server };

// 初始化数据并启动监听
await Promise.all([
  apiKeyManager.init(),
  channelManager.init()
]);

server.listen(config.server.port, config.server.host, () => {
  const protocol = useSSL ? 'https' : 'http';
  logger.info(`=======================================================`);
  logger.info(`🚀 API 聚合分流网关已启动 (${protocol.toUpperCase()}): ${protocol}://${config.server.host}:${config.server.port}`);
  logger.info(`🔑 默认 API Key: ${config.security.apiKey}`);
  logger.info(`👤 管理员账号: ${config.admin.username} / 密码: ${config.admin.password}`);
  logger.info(`=======================================================`);
});

server.on('error', (err) => {
  logger.error('服务器启动失败:', err.message);
  process.exit(1);
});

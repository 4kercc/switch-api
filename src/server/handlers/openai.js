/**
 * OpenAI 协议处理程序 (支持路径分流与默认模型降级)
 */
import channelManager from '../../utils/channelManager.js';
import logger from '../../utils/logger.js';
import { forwardToExternalOpenAIChannel } from '../../api/externalChannelClient.js';
import {
  setStreamHeaders,
  createHeartbeat,
  createResponseMeta,
  createStreamChunk,
  createOpenAIResponse,
  writeStreamData,
  endStream
} from '../stream.js';

export const handleOpenAIRequest = async (req, res) => {
  const body = req.body || {};
  const { messages, model, stream = false } = body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages is required and must be an array' });
  }
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model is required' });
  }

  res.locals.model = model;

  // 1. 获取匹配的外部渠道 (优先使用命中路径绑定的渠道，否则获取全局轮询渠道)
  const channel = res.locals.targetChannel || await channelManager.getChannel(model);

  if (!channel) {
    if (res.locals.unmatchedPathPrefix) {
      return res.status(404).json({ error: `未找到绑定本地分流路径 [${res.locals.unmatchedPathPrefix}] 的可用外部渠道` });
    }
    return res.status(503).json({ error: '没有可用的外部渠道，请在管理后台添加外部上游渠道配置' });
  }

  // 2. 检查模型降级逻辑
  const { targetModel, isDowngraded } = channelManager.resolveModelForChannel(channel, model);
  const modelLog = isDowngraded ? `${model} -> 降级为: ${targetModel}` : model;
  const routeLog = res.locals.pathPrefix ? `本地路径: ${res.locals.pathPrefix}` : '全局分流';

  logger.info(`🔀 [渠道: ${channel.name}] 正在处理 OpenAI 请求 (${modelLog}) [${routeLog}]`);
  res.locals.channelName = channel.name;

  const outgoingBody = isDowngraded ? { ...body, model: targetModel } : body;
  const { id, created } = createResponseMeta();

  if (stream) {
    setStreamHeaders(res);
    const heartbeatTimer = createHeartbeat(res);
    try {
      let usageData = null;
      let finishReason = 'stop';

      await forwardToExternalOpenAIChannel(channel, outgoingBody, true, (data) => {
        if (data.type === 'usage') {
          usageData = data.usage;
        } else if (data.type === 'reasoning') {
          writeStreamData(res, createStreamChunk(id, created, model, { reasoning_content: data.reasoning_content }));
        } else if (data.type === 'tool_calls') {
          finishReason = 'tool_calls';
          writeStreamData(res, createStreamChunk(id, created, model, { tool_calls: data.tool_calls }));
        } else if (data.type === 'content') {
          writeStreamData(res, createStreamChunk(id, created, model, { content: data.content }));
        }
      });

      writeStreamData(res, { ...createStreamChunk(id, created, model, {}, finishReason), usage: usageData });
      if (usageData) {
        res.locals.tokenUsage = usageData;
        channelManager.recordUsage(channel.id, usageData).catch(() => {});
      } else {
        channelManager.recordUsage(channel.id, null).catch(() => {});
      }
      clearInterval(heartbeatTimer);
      return endStream(res);
    } catch (err) {
      clearInterval(heartbeatTimer);
      logger.error(`外部渠道 [${channel.name}] 处理流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: `External channel error: ${err.message}` });
      } else {
        return endStream(res);
      }
    }
  } else {
    // 非流式
    try {
      const resp = await forwardToExternalOpenAIChannel(channel, outgoingBody, false);
      if (resp.usage) {
        res.locals.tokenUsage = resp.usage;
        channelManager.recordUsage(channel.id, resp.usage).catch(() => {});
      } else {
        channelManager.recordUsage(channel.id, null).catch(() => {});
      }
      return res.json(createOpenAIResponse({
        id,
        created,
        model,
        content: resp.content,
        reasoningContent: resp.reasoning,
        toolCalls: resp.toolCalls,
        usage: resp.usage
      }));
    } catch (err) {
      logger.error(`外部渠道 [${channel.name}] 处理非流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: `External channel error: ${err.message}` });
      }
    }
  }
};

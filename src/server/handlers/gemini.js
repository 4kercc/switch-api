/**
 * Gemini 协议处理程序
 */
import channelManager from '../../utils/channelManager.js';
import logger from '../../utils/logger.js';
import { forwardToExternalOpenAIChannel } from '../../api/externalChannelClient.js';
import { setStreamHeaders, createHeartbeat, endStream, writeStreamData } from '../stream.js';

export function createGeminiResponse(content, finishReason = null, usage = null) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: content || ''
            }
          ],
          role: 'model'
        },
        finishReason: finishReason || 'STOP',
        index: 0
      }
    ],
    usageMetadata: usage ? {
      promptTokenCount: usage.prompt_tokens || 0,
      candidatesTokenCount: usage.completion_tokens || 0,
      totalTokenCount: usage.total_tokens || 0
    } : undefined
  };
}

export const handleGeminiRequest = async (req, res, isStream = false) => {
  const body = req.body || {};
  let modelName = req.params.model || 'gemini-2.5-pro';
  if (modelName.includes(':')) {
    modelName = modelName.split(':')[0];
  }
  if (modelName.startsWith('models/')) {
    modelName = modelName.replace('models/', '');
  }

  res.locals.model = modelName;

  const channel = res.locals.targetChannel || await channelManager.getChannel(modelName);
  if (!channel) {
    if (res.locals.unmatchedPathPrefix) {
      return res.status(404).json({ error: { code: 404, message: `未找到绑定本地分流路径 [${res.locals.unmatchedPathPrefix}] 的可用外部渠道` } });
    }
    return res.status(503).json({ error: { code: 503, message: '没有可用的外部渠道' } });
  }

  const { targetModel, isDowngraded } = channelManager.resolveModelForChannel(channel, modelName);
  const modelLog = isDowngraded ? `${modelName} -> 降级为: ${targetModel}` : modelName;
  const routeLog = res.locals.pathPrefix ? `本地路径: ${res.locals.pathPrefix}` : '全局分流';

  logger.info(`🔀 [渠道: ${channel.name}] 正在处理 Gemini 请求 (${modelLog}) [${routeLog}]`);
  res.locals.channelName = channel.name;

  const openAiMessages = [];
  if (Array.isArray(body.contents)) {
    for (const c of body.contents) {
      const role = c.role === 'model' ? 'assistant' : 'user';
      let text = '';
      if (Array.isArray(c.parts)) {
        text = c.parts.map(p => p.text || '').join('');
      }
      openAiMessages.push({ role, content: text });
    }
  }

  const openAiPayload = {
    model: targetModel,
    messages: openAiMessages
  };

  if (isStream) {
    setStreamHeaders(res);
    const heartbeatTimer = createHeartbeat(res);
    try {
      let usageData = null;
      await forwardToExternalOpenAIChannel(channel, openAiPayload, true, (data) => {
        if (data.type === 'usage') {
          usageData = data.usage;
        } else if (data.type === 'content') {
          writeStreamData(res, createGeminiResponse(data.content, null, usageData));
        }
      });

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
      logger.error(`外部渠道 [${channel.name}] 处理 Gemini 流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: { code: 502, message: err.message } });
      } else {
        return endStream(res);
      }
    }
  } else {
    try {
      const resp = await forwardToExternalOpenAIChannel(channel, openAiPayload, false);
      if (resp.usage) {
        res.locals.tokenUsage = resp.usage;
        channelManager.recordUsage(channel.id, resp.usage).catch(() => {});
      } else {
        channelManager.recordUsage(channel.id, null).catch(() => {});
      }
      return res.json(createGeminiResponse(resp.content, 'STOP', resp.usage));
    } catch (err) {
      logger.error(`外部渠道 [${channel.name}] 处理 Gemini 非流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: { code: 502, message: err.message } });
      }
    }
  }
};

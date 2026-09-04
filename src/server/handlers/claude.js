/**
 * Claude /v1/messages 协议处理程序
 */
import channelManager from '../../utils/channelManager.js';
import logger from '../../utils/logger.js';
import { forwardToExternalOpenAIChannel } from '../../api/externalChannelClient.js';
import { setStreamHeaders, createHeartbeat, endStream } from '../stream.js';

export function createClaudeStreamEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createClaudeResponse(msgId, model, content, reasoning, stopReason = "end_turn", usage = null) {
  const contentBlocks = [];
  if (reasoning) {
    contentBlocks.push({ type: "thinking", thinking: reasoning });
  }
  if (content) {
    contentBlocks.push({ type: "text", text: content });
  }
  return {
    id: msgId,
    type: "message",
    role: "assistant",
    content: contentBlocks,
    model: model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0
    }
  };
}

export const handleClaudeRequest = async (req, res, isStream = false) => {
  const body = req.body || {};
  const { messages, model, system, max_tokens, temperature } = body;

  if (!model) {
    return res.status(400).json({ error: { type: 'invalid_request_error', message: 'model is required' } });
  }

  res.locals.model = model;

  const channel = res.locals.targetChannel || await channelManager.getChannel(model);
  if (!channel) {
    if (res.locals.unmatchedPathPrefix) {
      return res.status(404).json({ error: { type: 'invalid_request_error', message: `未找到绑定本地分流路径 [${res.locals.unmatchedPathPrefix}] 的可用外部渠道` } });
    }
    return res.status(503).json({ error: { type: 'api_error', message: '没有可用的外部渠道' } });
  }

  const { targetModel, isDowngraded } = channelManager.resolveModelForChannel(channel, model);
  const modelLog = isDowngraded ? `${model} -> 降级为: ${targetModel}` : model;
  const routeLog = res.locals.pathPrefix ? `本地路径: ${res.locals.pathPrefix}` : '全局分流';

  logger.info(`🔀 [渠道: ${channel.name}] 正在处理 Claude 格式请求 (${modelLog}) [${routeLog}]`);
  res.locals.channelName = channel.name;
  const msgId = `msg_${Date.now()}`;

  const openAiMessages = [];
  if (system) {
    openAiMessages.push({ role: 'system', content: typeof system === 'string' ? system : JSON.stringify(system) });
  }
  if (Array.isArray(messages)) {
    for (const m of messages) {
      openAiMessages.push({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      });
    }
  }

  const openAiPayload = {
    model: targetModel,
    messages: openAiMessages,
    max_tokens: max_tokens || 4096,
    temperature: temperature ?? 1
  };

  if (isStream) {
    setStreamHeaders(res);
    const heartbeatTimer = createHeartbeat(res);
    try {
      res.write(createClaudeStreamEvent('message_start', {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          content: [],
          model: model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      }));

      let contentIndex = 0;
      let textStarted = false;
      let usageData = null;

      await forwardToExternalOpenAIChannel(channel, openAiPayload, true, (data) => {
        if (data.type === 'usage') {
          usageData = data.usage;
        } else if (data.type === 'content') {
          if (!textStarted) {
            textStarted = true;
            res.write(createClaudeStreamEvent('content_block_start', {
              type: "content_block_start",
              index: contentIndex,
              content_block: { type: "text", text: "" }
            }));
          }
          res.write(createClaudeStreamEvent('content_block_delta', {
            type: "content_block_delta",
            index: contentIndex,
            delta: { type: "text_delta", text: data.content }
          }));
        }
      });

      if (textStarted) {
        res.write(createClaudeStreamEvent('content_block_stop', {
          type: "content_block_stop",
          index: contentIndex
        }));
      }

      res.write(createClaudeStreamEvent('message_delta', {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: usageData?.completion_tokens || 0 }
      }));

      res.write(createClaudeStreamEvent('message_stop', { type: "message_stop" }));

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
      logger.error(`外部渠道 [${channel.name}] 处理 Claude 流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: { type: 'api_error', message: err.message } });
      } else {
        return res.end();
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
      return res.json(createClaudeResponse(
        msgId,
        model,
        resp.content,
        resp.reasoning,
        "end_turn",
        resp.usage
      ));
    } catch (err) {
      logger.error(`外部渠道 [${channel.name}] 处理 Claude 非流式请求失败:`, err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: { type: 'api_error', message: err.message } });
      }
    }
  }
};

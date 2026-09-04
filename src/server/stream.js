/**
 * SSE 流式输出与心跳辅助工具
 */
export function setStreamHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

export function writeStreamData(res, data) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return res.write(`data: ${payload}\n\n`);
  } catch (err) {
    return false;
  }
}

export function endStream(res) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {}
}

export function createHeartbeat(res, interval = 15000) {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(timer);
    }
  }, interval);
  return timer;
}

export function createResponseMeta() {
  return {
    id: 'chatcmpl-' + Math.random().toString(36).substring(2, 12),
    created: Math.floor(Date.now() / 1000)
  };
}

export function createStreamChunk(id, created, model, delta = {}, finish_reason = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason
      }
    ]
  };
}

export function createOpenAIResponse({ id, created, model, content, reasoningContent, toolCalls, usage }) {
  const message = {
    role: 'assistant',
    content: content || null
  };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  if (toolCalls) {
    message.tool_calls = toolCalls;
  }
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls ? 'tool_calls' : 'stop'
      }
    ],
    usage: usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}

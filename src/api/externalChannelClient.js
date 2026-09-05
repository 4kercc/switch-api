/**
 * 外部上游渠道请求客户端 (支持 OpenAI / Claude / Gemini 三大协议模式智能端点拼接与中继转发)
 */
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import config from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * 根据渠道协议类型智能规范化上游请求完整端点
 * 用户只需填写基础域名（如 https://api.openai.com 或 https://token.mx.mk/v2），系统自动补齐：
 * - openai: 拼接 /chat/completions (或在 /v1 基础补齐)
 * - claude: 拼接 /v1/messages
 * - gemini: 基础 URL 保持
 *
 * @param {string} baseUrl - 用户填写的 Base URL
 * @param {string} type - 协议类型: 'openai' | 'claude' | 'gemini'
 * @param {string} model - 模型名称 (用于 Gemini 接口)
 * @returns {string} 规范化后的完整上游 URL
 */
export function normalizeUpstreamEndpoint(baseUrl = '', type = 'openai', model = '') {
  let cleanUrl = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanUrl) return '';

  const channelType = (type || 'openai').toLowerCase();

  if (channelType === 'openai') {
    if (cleanUrl.endsWith('/chat/completions')) {
      return cleanUrl;
    }
    return `${cleanUrl}/chat/completions`;
  }

  if (channelType === 'claude') {
    if (cleanUrl.endsWith('/messages') || cleanUrl.endsWith('/v1/messages')) {
      return cleanUrl;
    }
    if (cleanUrl.endsWith('/v1')) {
      return `${cleanUrl}/messages`;
    }
    return `${cleanUrl}/v1/messages`;
  }

  if (channelType === 'gemini') {
    // 如果已有完整 models 路由
    if (cleanUrl.includes('/models/')) {
      return cleanUrl;
    }
    const cleanModel = model ? model.replace(/^models\//, '') : 'gemini-2.5-pro';
    if (cleanUrl.endsWith('/v1beta')) {
      return `${cleanUrl}/models/${cleanModel}:streamGenerateContent?alt=sse`;
    }
    return `${cleanUrl}/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;
  }

  // 默认 fallback 为 OpenAI
  if (cleanUrl.endsWith('/chat/completions')) return cleanUrl;
  return `${cleanUrl}/chat/completions`;
}

function getAxiosClient(targetUrl = '') {
  const clientConfig = {
    timeout: config.timeout || 120000,
  };

  let isLocalAddress = false;
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
      isLocalAddress = true;
    }
  } catch {}

  if (!isLocalAddress && config.proxy && typeof config.proxy === 'string') {
    if (config.proxy.startsWith('socks')) {
      const agent = new SocksProxyAgent(config.proxy);
      clientConfig.httpAgent = agent;
      clientConfig.httpsAgent = agent;
    }
  } else {
    clientConfig.proxy = false;
  }

  return axios.create(clientConfig);
}

/**
 * 转发请求至外部渠道
 */
export async function forwardToExternalOpenAIChannel(channel, payload, stream = false, onData = null) {
  const url = normalizeUpstreamEndpoint(channel.baseUrl, channel.type || 'openai', payload.model);
  const client = getAxiosClient(url);
  
  const headers = {
    'Content-Type': 'application/json'
  };

  const channelType = (channel.type || 'openai').toLowerCase();

  if (channel.apiKey) {
    if (channelType === 'claude') {
      headers['x-api-key'] = channel.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (channelType === 'gemini') {
      headers['x-goog-api-key'] = channel.apiKey;
    } else {
      headers['Authorization'] = `Bearer ${channel.apiKey}`;
    }
  }

  const cleanPayload = {
    model: payload.model,
    messages: payload.messages,
    stream: stream ? true : false
  };

  if (payload.temperature !== undefined) cleanPayload.temperature = payload.temperature;
  if (payload.top_p !== undefined) cleanPayload.top_p = payload.top_p;
  if (payload.max_tokens !== undefined) cleanPayload.max_tokens = payload.max_tokens;
  if (payload.tools !== undefined) cleanPayload.tools = payload.tools;
  if (payload.tool_choice !== undefined) cleanPayload.tool_choice = payload.tool_choice;
  if (payload.response_format !== undefined) cleanPayload.response_format = payload.response_format;

  if (stream) {
    const response = await client.post(url, cleanPayload, {
      headers,
      responseType: 'stream'
    });

    let buffer = '';
    let totalUsage = null;

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '').trim();
          if (dataStr === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (parsed.usage) {
              totalUsage = parsed.usage;
              if (onData) onData({ type: 'usage', usage: parsed.usage });
            }

            if (delta) {
              if (delta.reasoning_content || delta.thinking) {
                if (onData) onData({
                  type: 'reasoning',
                  reasoning_content: delta.reasoning_content || delta.thinking
                });
              }
              if (delta.content) {
                if (onData) onData({
                  type: 'content',
                  content: delta.content
                });
              }
              if (delta.tool_calls) {
                if (onData) onData({
                  type: 'tool_calls',
                  tool_calls: delta.tool_calls
                });
              }
            }
          } catch (e) {}
        }
      });

      response.data.on('end', () => {
        resolve({ usage: totalUsage });
      });

      response.data.on('error', (err) => {
        logger.error(`外部渠道 [${channel.name}] (${url}) 流式响应异常:`, err.message);
        reject(err);
      });
    });
  } else {
    // 非流式
    const response = await client.post(url, cleanPayload, { headers });
    const data = response.data;
    const choice = data.choices?.[0];
    const message = choice?.message || {};

    return {
      content: message.content || '',
      reasoning: message.reasoning_content || message.thinking || null,
      toolCalls: message.tool_calls || null,
      usage: data.usage || null
    };
  }
}

export async function testExternalChannel(channel, testModel = null) {
  const modelToTest = testModel || channel.defaultModel || (channel.models && channel.models[0] && channel.models[0] !== '*' ? channel.models[0] : 'gpt-4o');
  const start = Date.now();
  const res = await forwardToExternalOpenAIChannel(channel, {
    model: modelToTest,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 5
  }, false);

  const latencyMs = Date.now() - start;
  return {
    success: true,
    latencyMs,
    modelTested: modelToTest,
    replyPreview: (res.content || '').substring(0, 50)
  };
}

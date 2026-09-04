/**
 * 外部上游渠道请求客户端 (支持 OpenAI 协议标准转发与流式/非流式解析)
 */
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import config from '../config/config.js';
import logger from '../utils/logger.js';

export function normalizeUpstreamEndpoint(baseUrl = '') {
  let cleanUrl = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanUrl) return '';
  if (cleanUrl.endsWith('/chat/completions')) {
    return cleanUrl;
  }
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

export async function forwardToExternalOpenAIChannel(channel, payload, stream = false, onData = null) {
  const url = normalizeUpstreamEndpoint(channel.baseUrl);
  const client = getAxiosClient(url);
  
  const headers = {
    'Content-Type': 'application/json'
  };
  if (channel.apiKey) {
    headers['Authorization'] = `Bearer ${channel.apiKey}`;
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

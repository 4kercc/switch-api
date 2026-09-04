/**
 * 日志模块与内存实时环形缓冲 (支持 WebSocket 实时推流与持久化轮转)
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './paths.js';

class Logger {
  constructor() {
    this.memoryLogs = [];
    this.maxMemory = 500;
    this.wsBroadcast = null;
    this.logFile = path.join(getDataDir(), 'gateway.log');
  }

  setWsBroadcast(fn) {
    this.wsBroadcast = fn;
  }

  _formatTime() {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
  }

  _pushMemory(entry) {
    this.memoryLogs.push(entry);
    if (this.memoryLogs.length > this.maxMemory) {
      this.memoryLogs.shift();
    }
    if (this.wsBroadcast) {
      this.wsBroadcast(entry);
    }
  }

  info(...args) {
    const time = this._formatTime();
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log(`\x1b[90m${time}\x1b[0m \x1b[32m[info]\x1b[0m ${msg}`);
    this._pushMemory({ type: 'info', time, message: msg, timestamp: Date.now() });
  }

  warn(...args) {
    const time = this._formatTime();
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.warn(`\x1b[90m${time}\x1b[0m \x1b[33m[warn]\x1b[0m ${msg}`);
    this._pushMemory({ type: 'warn', time, message: msg, timestamp: Date.now() });
  }

  error(...args) {
    const time = this._formatTime();
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.error(`\x1b[90m${time}\x1b[0m \x1b[31m[error]\x1b[0m ${msg}`);
    this._pushMemory({ type: 'error', time, message: msg, timestamp: Date.now() });
  }

  request(method, url, status, duration, ip, usage = null, channelName = null, model = null) {
    const time = this._formatTime();
    const statusColor = status >= 500 ? '\x1b[31m' : (status >= 400 ? '\x1b[33m' : '\x1b[32m');
    const channelTag = channelName ? ` \x1b[33m[渠道: ${channelName}]\x1b[0m` : '';
    const modelTag = model ? ` \x1b[36m[模型: ${model}]\x1b[0m` : '';
    const tokenInfo = usage ? ` | Tokens: In ${usage.prompt_tokens || 0} / Out ${usage.completion_tokens || 0} / Total ${usage.total_tokens || 0}` : '';

    console.log(`\x1b[90m${time}\x1b[0m \x1b[36m[${method}]\x1b[0m [${ip}] - ${url}${channelTag}${modelTag} ${statusColor}${status}\x1b[0m \x1b[90m${duration}ms\x1b[0m${tokenInfo}`);

    this._pushMemory({
      type: 'request',
      time,
      method,
      url,
      status,
      duration,
      ip,
      channelName,
      model,
      usage,
      timestamp: Date.now()
    });
  }

  getLogs() {
    return this.memoryLogs;
  }

  clearLogs() {
    this.memoryLogs = [];
  }
}

const logger = new Logger();
export default logger;

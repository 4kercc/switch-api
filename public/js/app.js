/**
 * 控制台前端交互、WebSocket 日志流与各模块逻辑
 */

// Toast 提示
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 封装鉴权 fetch
async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include'
  });
  if (res.status === 401) {
    showLoginView();
    showToast('登录已过期，请重新登录', 'warning');
    throw new Error('Unauthorized');
  }
  return res;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateRandomPathPrefix() {
  const words = ['vip', 'fast', 'chan', 'pro', 'speed', 'turbo', 'relay', 'edge', 'pool', 'direct'];
  const word = words[Math.floor(Math.random() * words.length)];
  const randStr = Math.random().toString(36).substring(2, 6);
  return `/${word}-${randStr}`;
}

// ==================== 登录与页面初始化 ====================

function showLoginView() {
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('dashboardView').classList.add('hidden');
}

function showDashboardView(username = 'admin') {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashboardView').classList.remove('hidden');
  document.getElementById('currentUserSpan').textContent = username;
  
  // 初始化加载所有核心数据
  loadStats();
  loadChannels();
  loadKeys();
  loadConfig();
  connectWebSocket();
}

async function checkAuth() {
  try {
    const res = await fetch('/admin/auth/status', { credentials: 'include' });
    const data = await res.json();
    if (data.success && data.user) {
      showDashboardView(data.user.username);
    } else {
      showLoginView();
    }
  } catch (e) {
    showLoginView();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast('登录成功', 'success');
      showDashboardView(username);
    } else {
      showToast(data.message || '登录失败', 'error');
    }
  } catch (err) {
    showToast('登录异常: ' + err.message, 'error');
  }
}

async function handleLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  try {
    await fetch('/admin/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {}
  showLoginView();
  showToast('已退出登录', 'info');
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(el => {
    el.classList.toggle('active', el.id === tabId);
  });

  if (tabId === 'tab-overview') loadStats();
  if (tabId === 'tab-channels') loadChannels();
  if (tabId === 'tab-keys') loadApiKeys();
  if (tabId === 'tab-stats') loadApiKeys();
  if (tabId === 'tab-settings') {
    loadConfig();
    loadBlockedIps();
  }
}

// ==================== 实时看板与 WebSocket 日志 ====================

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}天 ${h}小时 ${m}分`;
  if (h > 0) return `${h}小时 ${m}分 ${s}秒`;
  return `${m}分 ${s}秒`;
}

async function loadStats() {
  try {
    const res = await authFetch('/admin/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.data;
      document.getElementById('statUptime').textContent = formatUptime(s.uptime);
      document.getElementById('statChannels').textContent = `${s.activeChannelsCount} / ${s.channelsCount}`;
      document.getElementById('statRequests').textContent = s.totalRequests.toLocaleString();
      document.getElementById('statTokens').textContent = s.totalTokens.toLocaleString();
      document.getElementById('statMemory').textContent = `${s.memory.rssMB} MB`;
    }
  } catch (e) {}
}

let ws = null;
function connectWebSocket() {
  if (ws && ws.readyState === 1) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/logs`);

  ws.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      appendConsoleLog(log);
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 3000);
  };
}

function appendConsoleLog(log) {
  const box = document.getElementById('consoleContainer');
  if (!box) return;

  const line = document.createElement('div');
  line.className = 'log-line';

  if (log.type === 'request') {
    const statusClass = log.status >= 500 ? 'log-s500' : (log.status >= 400 ? 'log-s400' : 'log-s200');
    const chanTag = log.channelName ? `<span class="log-chan">[渠道: ${escapeHtml(log.channelName)}]</span> ` : '';
    const modelTag = log.model ? `<span class="log-model">[${escapeHtml(log.model)}]</span> ` : '';
    const tokenInfo = log.usage ? ` <span style="color:#94a3b8;">| Tokens: In ${log.usage.prompt_tokens||0} / Out ${log.usage.completion_tokens||0}</span>` : '';
    const ipHtml = `<span class="ip-link" onclick="promptBlockIp('${escapeHtml(log.ip)}')" title="点击快捷将该 IP 加入黑名单/封禁">${escapeHtml(log.ip)}</span>`;

    line.innerHTML = `<span class="log-time">${log.time}</span> <span class="log-req">[${log.method}]</span> [${ipHtml}] - ${escapeHtml(log.url)} ${chanTag}${modelTag}<span class="${statusClass}">${log.status}</span> <span style="color:#64748b;">${log.duration}ms</span>${tokenInfo}`;
  } else {
    const color = log.type === 'error' ? '#ef4444' : (log.type === 'warn' ? '#f59e0b' : '#10b981');
    line.innerHTML = `<span class="log-time">${log.time}</span> <span style="color:${color}; font-weight:bold;">[${log.type}]</span> ${escapeHtml(log.message)}`;
  }

  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

async function clearLogs() {
  await authFetch('/admin/logs', { method: 'DELETE' });
  document.getElementById('consoleContainer').innerHTML = '<div class="log-line" style="color: #64748b;">[已清空控制台日志]</div>';
  showToast('日志已清空', 'info');
}

// ==================== 外部渠道分流管理 ====================

let cachedChannels = [];

async function loadChannels() {
  const container = document.getElementById('channelsContainer');
  try {
    const res = await authFetch('/admin/channels');
    const data = await res.json();
    if (data.success) {
      cachedChannels = data.data || [];
      renderChannels(cachedChannels);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:#ef4444; padding:20px;">加���渠道失败: ${e.message}</div>`;
  }
}

function renderChannels(list) {
  const container = document.getElementById('channelsContainer');
  if (!list || list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; background: #fff; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted);">
        <p style="font-size: 1rem; margin-bottom: 8px;">暂未配置外部上游渠道</p>
        <p style="font-size: 0.85rem; margin-bottom: 16px;">可添加多个第三方账号，并绑定专属分流路径（如 <code>/v2</code>、<code>/v3</code>、<code>/vip</code>）</p>
        <button class="btn btn-success" onclick="openAddChannelModal()">➕ 添加第一个渠道</button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(c => {
    const isEnabled = c.enable !== false;
    const pathPrefix = c.pathPrefix ? (c.pathPrefix.startsWith('/') ? c.pathPrefix : '/' + c.pathPrefix) : '';
    const modelsText = (c.models && c.models.length > 0) ? c.models.join(', ') : '全部支持 (*)';
    const defaultModelText = c.defaultModel ? c.defaultModel : '无 (保持原模型透传)';

    return `
      <div class="card-item">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span>${isEnabled ? '🟢' : '⚪'}</span>
            <strong style="font-size: 1rem;">${escapeHtml(c.name)}</strong>
            <span style="background: rgba(79, 70, 229, 0.1); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">
              ${(c.type || 'openai').toUpperCase()}
            </span>
            ${pathPrefix ? `
              <span style="background: rgba(245, 158, 11, 0.15); color: #b45309; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; border: 1px dashed rgba(245, 158, 11, 0.4);">
                🔀 分流路径: ${escapeHtml(pathPrefix)}
              </span>
            ` : `
              <span style="background: rgba(148, 163, 184, 0.15); color: #64748b; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">
                全局默认轮询
              </span>
            `}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label class="switch" style="transform: scale(0.85);">
              <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleChannel('${c.id}', this.checked)">
              <span class="slider"></span>
            </label>
            <button class="btn btn-sm btn-secondary" onclick="testChannel('${c.id}')">⚡ 测速</button>
            <button class="btn btn-sm btn-primary" onclick="openEditChannelModal('${c.id}')">✏️ 编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteChannel('${c.id}', '${escapeHtml(c.name)}')">🗑️</button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
          ${pathPrefix ? `
            <div style="grid-column: 1 / -1; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
              <div><strong>📍 客户端专属分流端点:</strong> <code style="color: #b45309; font-weight: bold;">${escapeHtml(pathPrefix)}/chat/completions</code></div>
              <button class="btn btn-xs btn-secondary" onclick="navigator.clipboard.writeText('${pathPrefix}/chat/completions'); showToast('已复制路径', 'info');">📋 复制</button>
            </div>
          ` : ''}
          <div><strong>上游 Base URL:</strong> <code>${escapeHtml(c.baseUrl)}</code></div>
          <div><strong>API Key:</strong> <code>${c.apiKeyMasked || '（免密）'}</code></div>
          <div><strong>累计调用 / Token:</strong> <b>${c.totalRequests || 0} 次</b> / <b>${(c.totalTokens || 0).toLocaleString()}</b></div>
          <div><strong>优先级:</strong> ${c.priority || 10}</div>
          <div style="grid-column: 1 / -1;"><strong>支持模型:</strong> <span style="color:#059669;">${escapeHtml(modelsText)}</span></div>
          <div style="grid-column: 1 / -1;"><strong>默认降级模型:</strong> <span style="color:#b45309; font-weight: bold;">${escapeHtml(defaultModelText)}</span></div>
        </div>
      </div>
    `;
  }).join('');
}

function openAddChannelModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">➕ 添加外部上游渠道</div>
      <div class="form-group">
        <label>渠道名称</label>
        <input type="text" id="addChanName" placeholder="例如: 斯巴达-1号 / mx.mk v2">
      </div>
      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label style="margin:0;">🔀 本地分流路径 (支持任意英文/版本号)</label>
          <button type="button" class="btn btn-xs btn-secondary" id="randomAddPathBtn">🎲 随机生成</button>
        </div>
        <input type="text" id="addChanPath" placeholder="例如: /v2, /v3, /vip, /fast" style="margin-top:4px;">
        <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">设置后客户端请求 <code>/xxx/chat/completions</code> 直接走此专属渠道；留空则参与全局轮询。</div>
      </div>
      <div class="form-group">
        <label>上游接口 Base URL *</label>
        <input type="text" id="addChanBaseUrl" placeholder="例如: https://token.mx.mk/v2 或 http://127.0.0.1:8088/v1">
      </div>
      <div class="form-group">
        <label>API Key (密钥，无密码可留空)</label>
        <input type="password" id="addChanApiKey" placeholder="sk-...">
      </div>
      <div class="form-group">
        <label>支持的模型列表 (英文逗号分隔，留空支持全部)</label>
        <input type="text" id="addChanModels" placeholder="例如: gpt-4o, claude-3-7-sonnet">
      </div>
      <div class="form-group">
        <label>🛡️ 默认降级模型 (Default Model)</label>
        <input type="text" id="addChanDefaultModel" placeholder="例如: gpt-5 (当客户端请求不受支持的模型时自动转换为此模型)">
      </div>
      <div class="form-group">
        <label>优先级 (默认 10，数值越小越优先)</label>
        <input type="number" id="addChanPriority" value="10" min="1" max="100">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-success" id="confirmAddChanBtn">确认添加</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#randomAddPathBtn').onclick = () => {
    modal.querySelector('#addChanPath').value = generateRandomPathPrefix();
  };

  modal.querySelector('#confirmAddChanBtn').onclick = async () => {
    const name = modal.querySelector('#addChanName').value.trim();
    const pathPrefix = modal.querySelector('#addChanPath').value.trim();
    const baseUrl = modal.querySelector('#addChanBaseUrl').value.trim();
    const apiKey = modal.querySelector('#addChanApiKey').value.trim();
    const modelsStr = modal.querySelector('#addChanModels').value.trim();
    const defaultModel = modal.querySelector('#addChanDefaultModel').value.trim();
    const priority = Number(modal.querySelector('#addChanPriority').value) || 10;

    if (!baseUrl) {
      showToast('请输入 Base URL', 'warning');
      return;
    }

    try {
      const res = await authFetch('/admin/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || '外部渠道',
          pathPrefix,
          baseUrl,
          apiKey,
          models: modelsStr ? modelsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
          defaultModel,
          priority,
          enable: true
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        modal.remove();
        loadChannels();
      } else {
        showToast(data.message || '添加失败', 'error');
      }
    } catch (e) {
      showToast('添加异常: ' + e.message, 'error');
    }
  };
}

function openEditChannelModal(id) {
  const chan = cachedChannels.find(c => c.id === id);
  if (!chan) return;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">✏️ 编辑外部上游渠道配置</div>
      <div class="form-group">
        <label>渠道名称</label>
        <input type="text" id="editChanName" value="${escapeHtml(chan.name || '')}">
      </div>
      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label style="margin:0;">🔀 本地分流路径 (支持任意英文/版本号)</label>
          <button type="button" class="btn btn-xs btn-secondary" id="randomEditPathBtn">🎲 随机生成</button>
        </div>
        <input type="text" id="editChanPath" value="${escapeHtml(chan.pathPrefix || '')}" placeholder="例如: /v2, /v3, /vip, /fast" style="margin-top:4px;">
      </div>
      <div class="form-group">
        <label>上游接口 Base URL *</label>
        <input type="text" id="editChanBaseUrl" value="${escapeHtml(chan.baseUrl || '')}">
      </div>
      <div class="form-group">
        <label>API Key (留空不修改)</label>
        <input type="password" id="editChanApiKey" placeholder="如需修改请输入新Key，否则留空">
      </div>
      <div class="form-group">
        <label>支持的模型列表 (英文逗号分隔)</label>
        <input type="text" id="editChanModels" value="${escapeHtml((chan.models || []).join(', '))}">
      </div>
      <div class="form-group">
        <label>🛡️ 默认降级模型 (Default Model)</label>
        <input type="text" id="editChanDefaultModel" value="${escapeHtml(chan.defaultModel || '')}">
      </div>
      <div class="form-group">
        <label>优先级 (默认 10)</label>
        <input type="number" id="editChanPriority" value="${chan.priority || 10}" min="1" max="100">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-primary" id="confirmEditChanBtn">💾 保存修改</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#randomEditPathBtn').onclick = () => {
    modal.querySelector('#editChanPath').value = generateRandomPathPrefix();
  };

  modal.querySelector('#confirmEditChanBtn').onclick = async () => {
    const name = modal.querySelector('#editChanName').value.trim();
    const pathPrefix = modal.querySelector('#editChanPath').value.trim();
    const baseUrl = modal.querySelector('#editChanBaseUrl').value.trim();
    const apiKey = modal.querySelector('#editChanApiKey').value.trim();
    const modelsStr = modal.querySelector('#editChanModels').value.trim();
    const defaultModel = modal.querySelector('#editChanDefaultModel').value.trim();
    const priority = Number(modal.querySelector('#editChanPriority').value) || 10;

    const updates = {
      name: name || chan.name,
      pathPrefix,
      baseUrl,
      models: modelsStr ? modelsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      defaultModel,
      priority
    };
    if (apiKey) updates.apiKey = apiKey;

    try {
      const res = await authFetch('/admin/channels/' + chan.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        showToast('渠道已更新', 'success');
        modal.remove();
        loadChannels();
      } else {
        showToast(data.message || '更新失败', 'error');
      }
    } catch (e) {
      showToast('更新异常: ' + e.message, 'error');
    }
  };
}

async function toggleChannel(id, enable) {
  try {
    await authFetch('/admin/channels/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable })
    });
    showToast(`渠道已${enable ? '开启' : '关闭'}`, 'info');
    loadChannels();
  } catch (e) {}
}

async function deleteChannel(id, name) {
  if (!confirm(`确定要删除渠道 [${name}] 吗？`)) return;
  try {
    await authFetch('/admin/channels/' + id, { method: 'DELETE' });
    showToast('渠道已删除', 'success');
    loadChannels();
  } catch (e) {}
}

async function testChannel(id) {
  showToast('正在测试延迟...', 'info');
  try {
    const res = await authFetch(`/admin/channels/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.message || '测试失败', 'error');
    }
  } catch (e) {
    showToast('测试异常: ' + e.message, 'error');
  }
}

// ==================== API Key 管理与统计看板 (完整移植) ====================

let globalApiKeysData = { keys: [], stats: {} };

async function loadApiKeys() {
  try {
    const res = await authFetch('/admin/api-keys');
    const data = await res.json();
    if (data.success) {
      globalApiKeysData = data.data || { keys: [], stats: {} };
      renderApiKeysTable();
      renderStatsDashboard();
    }
  } catch (e) {}
}

function renderApiKeysTable() {
  const tbody = document.getElementById('apiKeysTableBody');
  const statTotal = document.getElementById('keyStatTotal');
  const statEnabled = document.getElementById('keyStatEnabled');

  if (statTotal) statTotal.textContent = globalApiKeysData.stats?.totalKeys || globalApiKeysData.keys?.length || 0;
  if (statEnabled) statEnabled.textContent = globalApiKeysData.stats?.enabledKeys || 0;

  if (!tbody) return;

  const keys = globalApiKeysData.keys || [];
  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">暂无 API 密钥，点击右上角新建</td></tr>`;
    return;
  }

  tbody.innerHTML = keys.map(k => {
    const createdDate = k.createdAt ? new Date(k.createdAt).toLocaleString() : '-';
    const lastUsedDate = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '未使用';
    const requests = k.usage?.requests || 0;
    const totalTokensNum = k.usage?.totalTokens || 0;
    const totalTokensStr = totalTokensNum.toLocaleString();

    let maxTokensDisplay = '无限制';
    let isExceeded = false;
    let quotaPercent = 0;

    if (k.maxTokens && k.maxTokens > 0) {
      maxTokensDisplay = k.maxTokens.toLocaleString();
      quotaPercent = Math.min(100, Math.round((totalTokensNum / k.maxTokens) * 100));
      if (totalTokensNum >= k.maxTokens) {
        isExceeded = true;
      }
    }

    const keyDisplay = k.key.length > 14 
      ? (k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4)) 
      : k.key;

    return `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px; font-weight: bold; white-space: nowrap;">
          ${escapeHtml(k.name)}
          ${isExceeded ? '<span style="font-size: 0.72rem; background: #ef4444; color: #fff; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">额度已耗尽</span>' : ''}
        </td>
        <td style="padding: 10px; font-family: monospace; white-space: nowrap;">
          <code title="${escapeHtml(k.key)}">${escapeHtml(keyDisplay)}</code>
          <button class="btn btn-xs btn-secondary" onclick="navigator.clipboard.writeText('${escapeHtml(k.key)}'); showToast('密钥已复制', 'info');" style="margin-left: 4px;" title="复制完整 Key">📋</button>
        </td>
        <td style="padding: 10px; white-space: nowrap;">
          <label class="switch" style="transform: scale(0.8); transform-origin: left center;">
            <input type="checkbox" ${k.enabled ? 'checked' : ''} onchange="toggleApiKeyEnabled('${k.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td style="padding: 10px; white-space: nowrap;">${requests.toLocaleString()} 次</td>
        <td style="padding: 10px; white-space: nowrap;">
          <div style="font-weight: bold; color: ${isExceeded ? '#ef4444' : 'var(--primary)'};">
            ${totalTokensStr} <span style="font-weight: normal; color: #94a3b8; font-size: 0.85rem;">/ ${maxTokensDisplay}</span>
          </div>
          ${k.maxTokens ? `
            <div style="background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 4px; width: 120px;">
              <div style="width: ${quotaPercent}%; background: ${isExceeded ? '#ef4444' : '#10b981'}; height: 100%;"></div>
            </div>
          ` : ''}
        </td>
        <td style="padding: 10px; font-size: 0.82rem; color: #64748b; white-space: nowrap;">
          <div>创建: ${createdDate}</div>
          <div>使用: ${lastUsedDate}</div>
        </td>
        <td style="padding: 10px; text-align: right; white-space: nowrap;">
          <button class="btn btn-xs btn-primary" onclick="showEditApiKeyModal('${k.id}')" style="margin-right: 4px;">✏️ 编辑</button>
          <button class="btn btn-xs btn-danger" onclick="deleteApiKey('${k.id}', '${escapeHtml(k.name)}')">🗑️ 删除</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleApiKeyEnabled(id, enabled) {
  try {
    const res = await authFetch(`/admin/api-keys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`API 密钥已${enabled ? '启用' : '禁用'}`, 'info');
      loadApiKeys();
    }
  } catch (e) {}
}

function openAddKeyModal() {
  const defaultKey = 'sk-' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">➕ 新建 API 密钥</div>
      <div class="form-group">
        <label>密钥名称 / 备注</label>
        <input type="text" id="newApiKeyName" placeholder="例如: 生产应用 / 客户A" value="API Key">
      </div>
      <div class="form-group">
        <label>自定义密钥字符串 (留空自动生成)</label>
        <input type="text" id="newApiKeyString" placeholder="${defaultKey}">
      </div>
      <div class="form-group">
        <label>Token 累计消耗上限阈值 (设为 0 或留空代表无限制，例如: 100000000 即 1 亿 Token)</label>
        <input type="number" id="newApiKeyMaxTokens" placeholder="例如: 100000000">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-success" id="confirmCreateApiKeyBtn">确认创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#confirmCreateApiKeyBtn').onclick = async () => {
    const name = modal.querySelector('#newApiKeyName').value.trim();
    const key = modal.querySelector('#newApiKeyString').value.trim();
    const maxTokensVal = parseInt(modal.querySelector('#newApiKeyMaxTokens').value);
    const maxTokens = Number.isFinite(maxTokensVal) && maxTokensVal > 0 ? maxTokensVal : null;

    try {
      const res = await authFetch('/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key, maxTokens })
      });
      const data = await res.json();
      if (data.success) {
        showToast('API 密钥创建成功', 'success');
        modal.remove();
        loadApiKeys();
      } else {
        showToast(data.message || '创建失败', 'error');
      }
    } catch (e) {
      showToast('创建异常: ' + e.message, 'error');
    }
  };
}

function showEditApiKeyModal(id) {
  const keys = globalApiKeysData.keys || [];
  const targetKey = keys.find(k => k.id === id);
  if (!targetKey) return;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">✏️ 编辑 API 密钥【${escapeHtml(targetKey.name)}】</div>
      <div class="form-group">
        <label>密钥名称</label>
        <input type="text" id="editApiKeyName" value="${escapeHtml(targetKey.name)}">
      </div>
      <div class="form-group">
        <label>密钥字符串</label>
        <input type="text" id="editApiKeyString" value="${escapeHtml(targetKey.key)}">
      </div>
      <div class="form-group">
        <label>Token 累计消耗上限阈值 (0 或留空为不限制，例如: 100000000 代表 1 亿 Token)</label>
        <input type="number" id="editApiKeyMaxTokens" value="${targetKey.maxTokens || ''}" placeholder="不限制">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-primary" id="confirmEditApiKeyBtn">保存修改</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#confirmEditApiKeyBtn').onclick = async () => {
    const name = modal.querySelector('#editApiKeyName').value.trim();
    const key = modal.querySelector('#editApiKeyString').value.trim();
    const maxTokensVal = parseInt(modal.querySelector('#editApiKeyMaxTokens').value);
    const maxTokens = Number.isFinite(maxTokensVal) && maxTokensVal > 0 ? maxTokensVal : null;

    try {
      const res = await authFetch(`/admin/api-keys/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key, maxTokens })
      });
      const data = await res.json();
      if (data.success) {
        showToast('API 密钥已更新', 'success');
        modal.remove();
        loadApiKeys();
      } else {
        showToast(data.message || '更新失败', 'error');
      }
    } catch (e) {
      showToast('更新失败: ' + e.message, 'error');
    }
  };
}

async function deleteApiKey(id, name) {
  if (!confirm(`确定要删除 API 密钥【${name}】吗？此操作无法撤销。`)) return;
  try {
    const res = await authFetch(`/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('API 密钥已删除', 'success');
      loadApiKeys();
    }
  } catch (e) {}
}

function renderStatsDashboard() {
  const keys = globalApiKeysData.keys || [];
  const select = document.getElementById('statsApiKeySelect');

  if (select) {
    const currentVal = select.value || 'all';
    select.innerHTML = `<option value="all">全部 API 密钥</option>` + keys.map(k =>
      `<option value="${k.id}">${escapeHtml(k.name)} (${k.key.substring(0, 6)}...)</option>`
    ).join('');
    select.value = currentVal;
  }

  const selectedId = select ? select.value : 'all';
  let filteredKeys = keys;
  if (selectedId !== 'all') {
    filteredKeys = keys.filter(k => k.id === selectedId);
  }

  let totalRequests = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalAll = 0;

  filteredKeys.forEach(k => {
    if (k.usage) {
      totalRequests += k.usage.requests || 0;
      totalInput += k.usage.inputTokens || 0;
      totalOutput += k.usage.outputTokens || 0;
      totalAll += k.usage.totalTokens || 0;
    }
  });

  const elReq = document.getElementById('dashTotalRequests');
  const elIn = document.getElementById('dashInputTokens');
  const elOut = document.getElementById('dashOutputTokens');
  const elTot = document.getElementById('dashTotalTokens');

  if (elReq) elReq.textContent = totalRequests.toLocaleString();
  if (elIn) elIn.textContent = totalInput.toLocaleString();
  if (elOut) elOut.textContent = totalOutput.toLocaleString();
  if (elTot) elTot.textContent = totalAll.toLocaleString();

  const tbody = document.getElementById('statsTableBody');
  if (!tbody) return;

  const overallTotalTokens = globalApiKeysData.stats?.totalTokens || totalAll || 1;

  if (filteredKeys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">暂无使用统计数据</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredKeys.map(k => {
    const u = k.usage || { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const percent = overallTotalTokens > 0 ? ((u.totalTokens / overallTotalTokens) * 100).toFixed(1) : '0.0';

    return `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px; font-weight: bold;">${escapeHtml(k.name)}</td>
        <td style="padding: 10px;">${(u.requests || 0).toLocaleString()} 次</td>
        <td style="padding: 10px; color: #10b981; font-weight: 500;">${(u.inputTokens || 0).toLocaleString()}</td>
        <td style="padding: 10px; color: #f59e0b; font-weight: 500;">${(u.outputTokens || 0).toLocaleString()}</td>
        <td style="padding: 10px; color: #3b82f6; font-weight: bold;">${(u.totalTokens || 0).toLocaleString()}</td>
        <td style="padding: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden; min-width: 80px;">
              <div style="width: ${percent}%; background: var(--primary); height: 100%;"></div>
            </div>
            <span style="font-size: 0.85rem; color: #64748b; min-width: 45px;">${percent}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 兼容别名
const loadKeys = loadApiKeys;

// ==================== 系统与 SSL 配置 ====================

async function loadConfig() {
  try {
    const res = await authFetch('/admin/config');
    const data = await res.json();
    if (data.success) {
      const cur = data.data.current;
      document.getElementById('cfgPort').value = cur.server.port;
      document.getElementById('cfgHost').value = cur.server.host;
      document.getElementById('cfgProxy').value = cur.proxy || '';
      document.getElementById('cfgSSL').value = cur.server.ssl ? 'true' : 'false';
      document.getElementById('cfgDomain').value = cur.server.domain || '';
    }

    const certRes = await authFetch('/admin/cert/status');
    const certData = await certRes.json();
    if (certData.success) {
      const info = certData.data;
      document.getElementById('certStatusInfo').textContent = info.exists
        ? `✅ 已检测到有效证书文件 (${info.certPath})`
        : `⚪ 尚未生成证书 (当前使用 HTTP 模式)`;
    }
  } catch (e) {}
}

async function saveSystemConfig() {
  const port = Number(document.getElementById('cfgPort').value);
  const host = document.getElementById('cfgHost').value.trim();
  const proxy = document.getElementById('cfgProxy').value.trim();
  const ssl = document.getElementById('cfgSSL').value === 'true';

  try {
    const res = await authFetch('/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        env: {
          PORT: port,
          HOST: host,
          PROXY: proxy,
          SSL: ssl
        },
        json: {
          server: { port, host, ssl }
        }
      })
    });
    const data = await res.json();
    showToast(data.message || '配置已保存', 'success');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function issueCert() {
  const domain = document.getElementById('cfgDomain').value.trim();
  if (!domain) {
    showToast('请输入要绑定的域名', 'warning');
    return;
  }

  showToast('正在申请/安装 ACME 证书...', 'info');
  try {
    const res = await authFetch('/admin/cert/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadConfig();
    } else {
      showToast(data.message || '签发失败', 'error');
    }
  } catch (e) {
    showToast('申请异常: ' + e.message, 'error');
  }
}

// ==================== IP 封禁与黑名单交互 ====================

async function loadBlockedIps() {
  const tbody = document.getElementById('blockedIpsTableBody');
  if (!tbody) return;

  try {
    const res = await authFetch('/admin/security/blocked-ips');
    const data = await res.json();
    if (data.success) {
      const list = data.data || [];
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">暂无被封禁的 IP</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(item => {
        const typeBadge = item.permanent 
          ? `<span style="background:#ef4444; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">永久黑名单</span>`
          : `<span style="background:#f59e0b; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem;">临时封禁</span>`;

        let statusText = '永久拦截';
        if (!item.permanent && item.expiresAt) {
          const remainMins = Math.max(1, Math.ceil((item.expiresAt - Date.now()) / 60000));
          statusText = `还剩 ${remainMins} 分钟解封`;
        }

        return `
          <tr style="border-bottom: 1px solid var(--border-color);">
            <td style="padding: 8px; font-family: monospace; font-weight: bold; color: #ef4444;">${escapeHtml(item.ip)}</td>
            <td style="padding: 8px;">${typeBadge}</td>
            <td style="padding: 8px; font-size: 0.85rem; color: #64748b;">${statusText}</td>
            <td style="padding: 8px;">${item.tempBlockCount || 0} 次</td>
            <td style="padding: 8px; text-align: right;">
              <button class="btn btn-xs btn-success" onclick="unblockIp('${escapeHtml(item.ip)}')">🔓 解除封禁</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {}
}

function promptBlockIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    showToast('本地回环 IP 不允许加入黑名单', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 440px;">
      <div class="modal-title">🛡️ 快捷封禁 / 加入黑名单</div>
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:12px; margin-bottom:14px; font-size:0.88rem; color:#991b1b;">
        是否将目标 IP <code>${escapeHtml(ip)}</code> 拦截封禁？
      </div>
      <div class="form-group">
        <label>封禁类型</label>
        <select id="quickBlockType">
          <option value="temp_60">临时封禁 60 分钟</option>
          <option value="temp_1440">临时封禁 24 小时</option>
          <option value="perm">永久加入黑名单 (禁止所有访问)</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-danger" id="confirmQuickBlockBtn">🚫 确认拦截</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#confirmQuickBlockBtn').onclick = async () => {
    const val = modal.querySelector('#quickBlockType').value;
    const permanent = val === 'perm';
    let durationMs = 60 * 60 * 1000;
    if (val === 'temp_1440') durationMs = 24 * 60 * 60 * 1000;

    try {
      const res = await authFetch('/admin/security/block-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, permanent, durationMs })
      });
      const data = await res.json();
      modal.remove();
      if (data.success) {
        showToast(data.message, 'success');
        loadBlockedIps();
      } else {
        showToast(data.message || '操作失败', 'error');
      }
    } catch (e) {
      showToast('请求异常: ' + e.message, 'error');
    }
  };
}

function openManualBlockModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 440px;">
      <div class="modal-title">➕ 手动添加封禁 IP</div>
      <div class="form-group">
        <label>IP 地址</label>
        <input type="text" id="manualBlockIp" placeholder="例如: 123.45.67.89">
      </div>
      <div class="form-group">
        <label>封禁类型</label>
        <select id="manualBlockType">
          <option value="perm">永久加入黑名单</option>
          <option value="temp_60">临时封禁 60 分钟</option>
          <option value="temp_1440">临时封禁 24 小时</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-danger" id="confirmManualBlockBtn">🚫 添加封禁</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#confirmManualBlockBtn').onclick = async () => {
    const ip = modal.querySelector('#manualBlockIp').value.trim();
    if (!ip) {
      showToast('请输入 IP 地址', 'warning');
      return;
    }
    const val = modal.querySelector('#manualBlockType').value;
    const permanent = val === 'perm';
    let durationMs = 60 * 60 * 1000;
    if (val === 'temp_1440') durationMs = 24 * 60 * 60 * 1000;

    try {
      const res = await authFetch('/admin/security/block-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, permanent, durationMs })
      });
      const data = await res.json();
      modal.remove();
      if (data.success) {
        showToast(data.message, 'success');
        loadBlockedIps();
      } else {
        showToast(data.message || '操作失败', 'error');
      }
    } catch (e) {
      showToast('请求异常: ' + e.message, 'error');
    }
  };
}

async function unblockIp(ip) {
  if (!confirm(`确定要解除对 IP [${ip}] 的封禁吗？`)) return;
  try {
    const res = await authFetch('/admin/security/unblock-ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadBlockedIps();
    } else {
      showToast(data.message || '操作失败', 'error');
    }
  } catch (e) {
    showToast('解封失败: ' + e.message, 'error');
  }
}

// 页面加载自启
window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

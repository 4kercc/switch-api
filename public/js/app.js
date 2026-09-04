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
  if (tabId === 'tab-keys') loadKeys();
  if (tabId === 'tab-settings') loadConfig();
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

    line.innerHTML = `<span class="log-time">${log.time}</span> <span class="log-req">[${log.method}]</span> [${log.ip}] - ${escapeHtml(log.url)} ${chanTag}${modelTag}<span class="${statusClass}">${log.status}</span> <span style="color:#64748b;">${log.duration}ms</span>${tokenInfo}`;
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

// ==================== API Key 管理 ====================

async function loadKeys() {
  const container = document.getElementById('keysContainer');
  try {
    const res = await authFetch('/admin/keys');
    const data = await res.json();
    if (data.success) {
      const keys = data.data || [];
      container.innerHTML = keys.map(k => `
        <div class="card-item">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <strong>${escapeHtml(k.name)}</strong>
              <span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${k.role}</span>
            </div>
            <button class="btn btn-sm btn-danger" onclick="deleteKey('${k.id}')">🗑️ 删除</button>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0; margin-top:4px;">
            <code style="font-size:0.9rem; color:#4f46e5; word-break:break-all;">${escapeHtml(k.key)}</code>
            <button class="btn btn-xs btn-secondary" onclick="navigator.clipboard.writeText('${escapeHtml(k.key)}'); showToast('密钥已复制', 'info');">📋 复制</button>
          </div>
          <div style="display:flex; gap:16px; font-size:0.8rem; color:#64748b; margin-top:4px;">
            <span>累计调用: <b>${k.totalRequests || 0} 次</b></span>
            <span>累计消耗: <b>${(k.totalTokens || 0).toLocaleString()} Tokens</b></span>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {}
}

function openAddKeyModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">➕ 创建新 API Key</div>
      <div class="form-group">
        <label>密钥名称 / 备注</label>
        <input type="text" id="addKeyName" placeholder="例如: 客户A / 生产应用">
      </div>
      <div class="form-group">
        <label>自定义 Key 字符串 (留空自动生成)</label>
        <input type="text" id="addKeyValue" placeholder="sk-...">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button class="btn btn-primary" id="confirmAddKeyBtn">确认创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#confirmAddKeyBtn').onclick = async () => {
    const name = modal.querySelector('#addKeyName').value.trim();
    const key = modal.querySelector('#addKeyValue').value.trim();

    try {
      const res = await authFetch('/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key })
      });
      const data = await res.json();
      if (data.success) {
        showToast('API Key 创建成功', 'success');
        modal.remove();
        loadKeys();
      }
    } catch (e) {
      showToast('创建失败: ' + e.message, 'error');
    }
  };
}

async function deleteKey(id) {
  if (!confirm('确定要删除该 API Key 吗？')) return;
  try {
    await authFetch('/admin/keys/' + id, { method: 'DELETE' });
    showToast('API Key 已删除', 'success');
    loadKeys();
  } catch (e) {}
}

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

// 页面加载自启
window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

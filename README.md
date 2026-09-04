# ⚡ API 聚合分流网关 (API Gateway All-in)

专注于大模型外部渠道聚合、全动态路由分流与模型自适应降级的高性能轻量网关。

---

## 🌟 核心特性

1. **全动态本地路径分流 (Path-Based Dynamic Routing)**：
   - 支持为每个外部上游渠道配置独立的本地路由路径（如 `/v2`、`/v3`、`/vip`、`/fast`、`/backup` 等）；
   - 客户端通过调用 `http://IP:8045/vip/chat/completions` 或 `http://IP:8045/fast/messages`，系统直接精准路由到该专属渠道；
   - 支持多个渠道绑定相同路径并自动进行 Round-Robin 轮询负载均衡；
   - 渠道未设置分流路径时自动参与 `/v1` 的全局轮询调度。

2. **智能模型降级自愈 (Default Model Fallback)**：
   - 支持为渠道设置【默认降级模型 (Default Model)】（例如 `gpt-5`）；
   - 当客户端发送了该渠道不支持的模型（例如客户端请求 `gpt-5.5`），系统自动在转发层转换为 `gpt-5` 转发，防止第三方上游直接拒绝或报 404/400 错误。

3. **登录即实时看板与 WebSocket 流式日志**：
   - 登录后台即可看到实时的请求流终端、请求总数、Token 消耗、活跃渠道数与系统内存占用；
   - 实时输出请求命中的渠道标签、模型标识、耗时与 HTTP 状态码。

4. **三大主流协议全兼容**：
   - **OpenAI 兼容**：`POST /v1/chat/completions` 与动态路径（流式 SSE 与非流式）；
   - **Claude 兼容**：`POST /v1/messages` 与动态路径；
   - **Gemini 兼容**：`POST /v1beta/models/...` 与动态路径。

5. **多 API Key 鉴权与独立统计**：
   - 支持创建多个 API Key，分别限制或追踪每个客户端/客户的调用次数与 Token 消耗。

6. **纯净轻量无多余依赖**：
   - 移除了原 Google Antigravity 原生账号池、Passkey、WARP 等非必要模块，代码高度精炼，启动速度极快。

---

## 🚀 快速启动

### 1. 安装依赖
```bash
cd antigravity-allin
npm install
```

### 2. 配置环境 (.env)
复制模板并修改你的管理密码与端口：
```bash
cp .env.example .env
```
主要配置项说明：
```bash
PORT=8045
HOST=0.0.0.0
SSL=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
API_KEY=sk-allin-gateway-master-key-2026
```

### 3. 启动服务
```bash
# 开发环境启动 (带文件热重载)
npm run dev

# 生产环境 PM2 后台启动
pm2 start src/server/index.js --name "api-allin" --max-memory-restart 200M
```

---

## 🌐 访问管理控制台
打开浏览器访问：`http://你的服务器IP:8045`，输入管理员账号密码即可进入实时看板与渠道分流配置中心！

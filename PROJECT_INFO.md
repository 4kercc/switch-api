# API 聚合分流系统架构全景与技术文档 (PROJECT_INFO)

## 📌 项目定位
本项目由 `antigravity2api` 独立解耦而来，剥离了原有的原生 Google 账号池及相关逆向协议模块，专注于打造一个**超轻量、高性能、高可用的多渠道 LLM API 聚合与全动态分流网关**。

---

## 🏗️ 架构分层设计

### 1. 动态分流引擎 (`src/server/index.js` & `src/utils/channelManager.js`)
- **第一段全动态路由提取**：系统使用正则捕获请求的第一段路径（如 `/v2`, `/v3`, `/vip`, `/fast` 等）；
- **保留路径防护**：内置 `/admin`, `/v1`, `/api`, `/health`, `/ws` 等系统保留字过滤，杜绝路由拦截冲突；
- **渠道绑定与负载均衡**：若某路径绑定了多个可用渠道，自动在这些渠道之间按 Round-Robin 算法分发请求；
- **智能降级模型 (`defaultModel`)**：当客户端请求不受该渠道支持的模型时，系统自动在转发前重写模型为渠道预设的 `defaultModel`，保障高容错性。

### 2. 统一协议中继与桥接 (`src/api/externalChannelClient.js`)
- **OpenAI 兼容**：支持标准 `POST /v1/chat/completions`、流式 SSE、reasoning/thinking 思考内容解析与 token usage 捕获；
- **Claude 兼容**：支持 `POST /v1/messages` 协议转换为标准 OpenAI 协议转发，并将流式分块无缝转换为 Claude `content_block_delta` SSE 格式输出；
- **Gemini 兼容**：支持 `POST /v1beta/models/...:generateContent` 与流式 SSE 格式转换。

### 3. 实时监控与 WebSocket 日志流 (`src/utils/logger.js`)
- **内存环形缓冲区 (Ring Buffer)**：在内存中保持最新的 500 条请求日志，零磁盘 IO 损耗；
- **WebSocket 实时推流**：当客户端请求到达与结束时，自动将状态码、耗时、渠道名称、模型标识与 Token 计数实时广播到前端控制台。

### 4. 鉴权与安全体系 (`src/auth/`)
- **管理员认证**：基于 JWT HttpOnly Cookie（支持 Lax/Secure 动态切换，兼容 HTTP 与 HTTPS 访问）；
- **API Key 多租户管理**：支持创建多个带独立备注与统计信息的 API 访问密钥。

---

## 📁 目录文件清单

```text
antigravity-allin/
├── package.json                   # 项目依赖声明 (Express, Axios, SOCKS, WS, JWT)
├── .env.example                   # 环境变量模板 (PORT, HOST, SSL, ADMIN_*, API_KEY)
├── config.json.example            # 运行偏好配置
├── README.md                      # 项目快速入门手册
├── PROJECT_INFO.md                # 架构设计全景文档
├── src/
│   ├── config/
│   │   └── config.js              # 配置加载、.env 解析与热更新
│   ├── auth/
│   │   ├── auth.js                # JWT 签名与密码比对
│   │   └── apiKeyManager.js       # 多 API Key 校验与持久化
│   ├── api/
│   │   └── externalChannelClient.js # Axios 转发中继、SOCKS 代理与流式清洗
│   ├── utils/
│   │   ├── paths.js               # 路径计算工具
│   │   ├── logger.js              # 内存日志缓冲与 WebSocket 广播
│   │   ├── cert.js                # 自签 SSL 与 ACME.sh 证书管理
│   │   └── channelManager.js      # 渠道 CRUD、分流路径匹配与默认模型降级
│   ├── routes/
│   │   └── admin.js               # 管理后台全部 REST API
│   └── server/
│       ├── stream.js              # SSE 流式协议与心跳
│       ├── handlers/
│       │   ├── openai.js          # /chat/completions 路由处理器
│       │   ├── claude.js          # /v1/messages 路由处理器
│       │   └── gemini.js          # /v1beta/models/... 路由处理器
│       └── index.js               # 主服务器、动态路由分流中间件与 WebSocket 服务
└── public/
    ├── index.html                 # 单页面控制台 (实时看板、渠道管理、Key管理、设置)
    ├── css/
    │   └── style.css              # 现代化响应式控制台样式
    └── js/
        └── app.js                 # 侧边栏切换、渠道/Key CRUD、实时 WS 渲染
```

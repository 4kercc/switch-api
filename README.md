<div align="center">

# ⚡ switch-api

**全动态多渠道大模型分流与聚合网关**

专注于大模型外部渠道聚合、全动态路由分流、三大主流协议兼容与模型自适应降级自愈的高性能轻量网关。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PM2 Ready](https://img.shields.io/badge/PM2-Daemon-orange.svg)](https://pm2.keymetrics.io/)
[![shadcn/ui](https://img.shields.io/badge/UI-shadcn%2Fui-black.svg)](https://ui.shadcn.com/)

[特性亮点](#-特性亮点) • [一键安装部署](#-一键安装部署) • [手动安装](#-手动安装) • [控制台使用](#-控制台使用) • [常用命令](#-常用运维命令)

</div>

---

## 🌟 特性亮点

1. **三大主流大模型协议全兼容**：
   - 🟢 **OpenAI 兼容**：`POST /v1/chat/completions` 与动态路径（支持 SSE 流式与 Thinking 思考解析）；
   - 🟣 **Claude 兼容**：`POST /v1/messages` 与动态路径（自动转换 Anthropic 协议与 `content_block_delta`）；
   - 🔵 **Gemini 兼容**：`POST /v1beta/models/...` 与动态路径。
   - **智能端点补齐**：添加渠道只需填写主机域名（如 `https://api.openai.com`），无需繁琐输入长 URL 后缀。

2. **全动态本地路径分流 (Path-based Routing)**：
   - 支持为每个外部上游渠道配置独立的本地路由路径（如 `/v2`、`/v3`、`/vip`、`/fast`、`/backup` 等）；
   - 客户端调用 `http://IP:8046/vip/chat/completions` 或 `http://IP:8046/fast/messages`，系统直接精准路由到对应专属渠道；
   - 多个渠道绑定同一路径自动进行 **Round-Robin 轮询负载均衡**；未指定路径则默认参与 `/v1` 全局轮询。

3. **模型自动降级自愈 (Default Model Fallback)**：
   - 支持为渠道设置【默认降级模型】（例如 `gpt-5`）；
   - 当客户端请求该渠道不支持的模型时（例如前端请求 `gpt-5.5`），网关自动无感转换为 `gpt-5` 转发至上游，彻底杜绝 404/400/500 报错。

4. **纯正 shadcn/ui 现代设计系统**：
   - 全新 Zinc 灰度中性调、精致卡片式布局、移动端抽屉自适应（Mobile Friendly）；
   - 登录即进入沉浸式 **实时 WebSocket 请求流监控终端**，状态码、耗时、渠道与模型一目了然。

5. **多租户 API Key 额度熔断与 IP 安全防御**：
   - 支持创建多个独立 API Key，分别设置 **Token 消耗上限阈值**（达到上限自动熔断标记“额度已耗尽”）；
   - **智能 IP 防御**：连续 30 次异常自动封禁 60 分钟，连续 3 次封禁自动升级永久黑名单；
   - **快捷交互**：控制台日志中的 IP 支持直接点击唤起弹窗快捷封禁与解封。

---

## 🚀 一键安装部署 (推荐)

在全新 Linux 服务器（Ubuntu / Debian / CentOS / Rocky Linux）以 root 权限执行以下命令，即可全自动完成 Node.js、PM2、依赖下载、配置初始化并开机自启：

```bash
curl -fsSL https://raw.githubusercontent.com/4kercc/switch-api/main/setup.sh | bash
```

或者使用 Git 方式一键部署：

```bash
git clone https://github.com/4kercc/switch-api.git switch-api && cd switch-api && bash setup.sh
```

---

## 🛠️ 手动安装

### 1. 克隆代码与安装依赖
```bash
git clone https://github.com/4kercc/switch-api.git /home/switch-api && cd /home/switch-api
npm install --omit=dev
```

### 2. 配置环境 (.env)
```bash
cp .env.example .env
```
配置示例：
```ini
PORT=8046
HOST=0.0.0.0
SSL=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123456
API_KEY=sk-switch-api-master-key-2026
```

### 3. 使用 PM2 后台启动
```bash
pm2 start src/server/index.js --name "switch-api" --max-memory-restart 200M --merge-logs
pm2 save && pm2 startup
```

---

## 🖥️ 控制台使用

浏览器打开：`http://你的服务器IP:8046`
* **默认账号**：`admin`
* **默认密码**：`admin123456`

1. **添加外部渠道**：点击「外部渠道分流」->「添加外部渠道」，选择协议类型（OpenAI / Claude / Gemini），填入上游 Base URL、密钥与可选的本地分流路径；
2. **客户端调用**：
   - 默认接口：`http://你的IP:8046/v1/chat/completions`
   - 专属分流接口：`http://你的IP:8046/vip/chat/completions`
3. **查看实时日志**：登录后首屏即可实时查看每一次调用的流式日志、耗时与 IP 归属。

---

## 📋 常用运维命令

```bash
# 查看网关实时运行状态
pm2 status switch-api

# 查看实时日志终端
pm2 logs switch-api

# 一键拉取最新版本并平滑重载
bash update.sh

# 重启网关服务
pm2 restart switch-api
```

---

## 📄 开源许可证

[MIT License](LICENSE) © 2026 4kercc

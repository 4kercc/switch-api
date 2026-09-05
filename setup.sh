#!/usr/bin/env bash

# ==============================================================================
# switch-api 一键自动部署与 PM2 守护安装脚本
# 适用系统: Ubuntu / Debian / CentOS / Rocky Linux / AlmaLinux / Alpine
# ==============================================================================

set -e

echo "========================================================================"
echo "⚡ switch-api: 全动态多渠道大模型分流与聚合网关 一键部署脚本"
echo "========================================================================"
echo

# 1. 基础配置
REPO_URL="https://github.com/4kercc/switch-api.git"
BRANCH="main"
TARGET_DIR="switch-api"
APP_NAME="switch-api"
DEFAULT_PORT="8046"

# 2. 自动检测与安装系统基础环境依赖
echo "[1/6] 检查系统基础依赖工具 (curl, git, openssl)..."
if ! command -v curl &> /dev/null || ! command -v git &> /dev/null || ! command -v openssl &> /dev/null; then
    echo "正在为您安装基础系统包..."
    if command -v apt-get &> /dev/null; then
        apt-get update -y && apt-get install -y curl git openssl build-essential
    elif command -v yum &> /dev/null; then
        yum install -y curl git openssl make gcc-c++
    elif command -v dnf &> /dev/null; then
        dnf install -y curl git openssl make gcc-c++
    elif command -v apk &> /dev/null; then
        apk add curl git openssl build-base
    fi
fi
echo "✓ 基础系统依赖就绪"

# 3. 自动克隆或定位到项目目录
echo
echo "[2/6] 获取项目代码与定位工作目录..."
if [ -f "package.json" ] && grep -q "api-gateway-allin" package.json 2>/dev/null; then
    echo "✓ 当前目录已被识别为 switch-api 项目根目录: $(pwd)"
elif [ -d "$TARGET_DIR" ]; then
    echo "进入已存在的 ${TARGET_DIR} 目录..."
    cd "$TARGET_DIR"
else
    echo "正在从 GitHub 克隆分支 [${BRANCH}] 到 ./${TARGET_DIR}..."
    git clone -b "$BRANCH" "$REPO_URL" "$TARGET_DIR"
    cd "$TARGET_DIR"
fi

PROJECT_ABS_PATH="$(pwd)"
echo "✓ 确立程序绝对工作目录: ${PROJECT_ABS_PATH}"

# 4. 自动检测与安装 Node.js LTS (v20)
echo
echo "[3/6] 检查 Node.js 运行环境..."
if ! command -v node &> /dev/null; then
    echo "⚠️ 未检测到 Node.js，正在自动为您安装 Node.js LTS (v20)..."
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif command -v yum &> /dev/null || command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs 2>/dev/null || dnf install -y nodejs
    else
        echo "❌ 无法自动安装 Node.js，请手动安装 Node.js v18+ 后重新运行。"
        exit 1
    fi
fi

NODE_VER=$(node -v)
echo "✓ Node.js 环境正常: ${NODE_VER}"

# 5. 安装 NPM 运行依赖
echo
echo "[4/6] 安装项目 NPM 依赖..."
npm install --omit=dev
if [ $? -ne 0 ]; then
    echo "❌ NPM 依赖安装失败，请检查网络后重试。"
    exit 1
fi
echo "✓ NPM 依赖安装完成"

# 6. 初始化环境配置文件与凭据
echo
echo "[5/6] 配置文件与初始化设置..."

SERVER_PUBLIC_IP=$(curl -s --connect-timeout 3 https://api.ipify.org || curl -s --connect-timeout 3 https://ifconfig.me || curl -s --connect-timeout 3 https://ipinfo.io/ip || echo "127.0.0.1")

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        touch .env
    fi
fi

if [ ! -f "config.json" ] && [ -f "config.json.example" ]; then
    cp config.json.example config.json
fi

# 交互式或默认配置
read -p "请输入网关服务监听端口 (默认: ${DEFAULT_PORT}): " PORT_INPUT
FINAL_PORT=${PORT_INPUT:-$DEFAULT_PORT}

read -p "请输入管理员登录账号 (默认: admin): " ADMIN_USER
FINAL_ADMIN_USER=${ADMIN_USER:-admin}

read -p "请输入管理员登录密码 (默认: admin123456): " ADMIN_PASS
FINAL_ADMIN_PASS=${ADMIN_PASS:-admin123456}

DEFAULT_GEN_KEY="sk-$(head /dev/urandom | tr -dc a-z0-9 | head -c 24 2>/dev/null || echo "key_$(date +%s)")"
read -p "请输入初始 API 密钥 (回车自动生成): " API_KEY_INPUT
FINAL_API_KEY=${API_KEY_INPUT:-$DEFAULT_GEN_KEY}

RANDOM_JWT_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32 2>/dev/null || echo "secret_$(date +%s)")

# 更新 .env 变量
cat > .env << EOF
# 服务端口与主机监听
PORT=${FINAL_PORT}
HOST=0.0.0.0

# 是否开启 HTTPS (true/false)
SSL=false

# 域名配置 (可选)
DOMAIN=

# 管理后台管理员登录凭据
ADMIN_USERNAME=${FINAL_ADMIN_USER}
ADMIN_PASSWORD=${FINAL_ADMIN_PASS}
JWT_SECRET=${RANDOM_JWT_SECRET}

# 系统全局默认 API Key
API_KEY=${FINAL_API_KEY}

# 可选 SOCKS5 代理
# PROXY=socks5://127.0.0.1:40000
EOF

# 7. 全局安装 PM2 并启动服务
echo
echo "[6/6] 配置 PM2 进程守护与开机自启动..."
if ! command -v pm2 &> /dev/null; then
    echo "正在全局安装 PM2 进程守护工具..."
    npm install -g pm2
fi

# 停止并删除旧进程
pm2 delete "$APP_NAME" > /dev/null 2>&1 || true

# 启动新实例
pm2 start "${PROJECT_ABS_PATH}/src/server/index.js" \
  --name "$APP_NAME" \
  --cwd "${PROJECT_ABS_PATH}" \
  --max-memory-restart 200M \
  --merge-logs

pm2 save
pm2 startup > /dev/null 2>&1 || true

echo
echo "========================================================================"
echo "🎉 switch-api 网关已成功部署并加入 PM2 后台持久守护！"
echo "========================================================================"
echo
echo "📂 项目安装路径: ${PROJECT_ABS_PATH}"
echo
echo "🌐 访问与登录信息:"
echo "   - 控制台地址:   http://${SERVER_PUBLIC_IP}:${FINAL_PORT}"
echo "   - 本地访问:     http://127.0.0.1:${FINAL_PORT}"
echo "   - 管理员账号:   ${FINAL_ADMIN_USER}"
echo "   - 管理员密码:   ${FINAL_ADMIN_PASS}"
echo "   - 系统主 API Key: ${FINAL_API_KEY}"
echo
echo "🛠️ 常用运维命令速查:"
echo "   - 查看服务状态:   pm2 status"
echo "   - 查看实时日志:   pm2 logs ${APP_NAME}"
echo "   - 平滑重启服务:   pm2 restart ${APP_NAME}"
echo "   - 停止网关服务:   pm2 stop ${APP_NAME}"
echo "   - 拉取更新并重启: bash update.sh"
echo "========================================================================"

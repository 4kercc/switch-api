#!/usr/bin/env bash

# ==============================================================================
# switch-api 一键更新与平滑重载脚本
# ==============================================================================

set -e

APP_NAME="switch-api"

echo "🔄 正在检查并拉取 switch-api 最新版本代码..."
git fetch origin main
git reset --hard origin/main

echo "📦 正在检查与更新项目依赖..."
npm install --omit=dev

echo "🚀 正在平滑重载 PM2 进程..."
pm2 reload "$APP_NAME" || pm2 restart "$APP_NAME"

echo "✓ switch-api 更新完成并已重新加载生效！"
pm2 status "$APP_NAME"

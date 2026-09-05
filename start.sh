#!/usr/bin/env bash

# ==============================================================================
# switch-api 快速启动脚本
# ==============================================================================

APP_NAME="switch-api"
PROJECT_ABS_PATH="$(pwd)"

if ! command -v pm2 &> /dev/null; then
    echo "正在使用 Node.js 直接前台启动..."
    node src/server/index.js
else
    echo "正在使用 PM2 后台守护启动..."
    pm2 start "${PROJECT_ABS_PATH}/src/server/index.js" --name "$APP_NAME" --cwd "${PROJECT_ABS_PATH}" --max-memory-restart 200M --merge-logs
    pm2 save
    pm2 status "$APP_NAME"
fi

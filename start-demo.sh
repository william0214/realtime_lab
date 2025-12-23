#!/bin/bash

# ============================================
# 🚀 即時翻譯系統 - Demo 一鍵啟動腳本
# ============================================

echo "╔════════════════════════════════════════════════════════════╗"
echo "║        🚀 即時翻譯系統 - Demo 啟動中...                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 取得腳本所在目錄
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 檢查是否有佔用的 port
echo "🔍 檢查 Port 狀態..."

check_port() {
    if lsof -ti:$1 > /dev/null 2>&1; then
        echo "   ⚠️  Port $1 已被佔用，正在釋放..."
        lsof -ti:$1 | xargs kill -9 2>/dev/null
        sleep 1
    fi
}

check_port 3001
check_port 3002
check_port 5173

echo "   ✅ Port 檢查完成"
echo ""

# 啟動 Server
echo "🖥️  啟動 Server (Port 3001)..."
osascript -e "tell app \"Terminal\" to do script \"cd '$SCRIPT_DIR/server' && npm run dev\""

sleep 2

# 啟動 Client
echo "🌐 啟動 Client (Port 5173)..."
osascript -e "tell app \"Terminal\" to do script \"cd '$SCRIPT_DIR/client' && npm run dev\""

sleep 2

# 啟動 TTS 播放器
echo "🎙️  啟動 TTS 播放器 (Port 3002)..."
osascript -e "tell app \"Terminal\" to do script \"cd '$SCRIPT_DIR/tools' && npx serve -p 3002\""

echo ""
echo "⏳ 等待服務啟動..."
sleep 5

# 開啟瀏覽器
echo "🌐 開啟瀏覽器..."
open http://localhost:5173
open http://localhost:3002/audio-player.html

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    ✅ Demo 環境已啟動！                    ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  📍 翻譯系統:    http://localhost:5173                     ║"
echo "║  📍 TTS 播放器:  http://localhost:3002/audio-player.html   ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  🧪 測試步驟:                                              ║"
echo "║     1. 在翻譯系統點擊「開始錄音」                          ║"
echo "║     2. 在 TTS 播放器播放測試語音                           ║"
echo "║     3. 觀察翻譯結果                                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

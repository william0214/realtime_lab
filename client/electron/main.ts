import { app, BrowserWindow, session } from 'electron';
import path from 'path';

// 判斷是否為開發模式
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: '會議小幫手 — 即時翻譯',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // 需要 sandbox: false 才能在 preload 中使用 desktopCapturer
        },
    });

    // 開發模式載入 Vite dev server，生產模式載入打包的 HTML
    if (isDev) {
        win.loadURL(DEV_URL);
        win.webContents.openDevTools();
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    return win;
}

app.whenReady().then(() => {
    // 設定 CSP — 允許連線到 localhost 的 WebSocket 和 API
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self';" +
                    " script-src 'self' 'unsafe-inline';" +
                    " style-src 'self' 'unsafe-inline';" +
                    " connect-src 'self' http://localhost:* ws://localhost:*;" +
                    " media-src 'self' mediastream:;" +
                    " img-src 'self' data:;"
                ],
            },
        });
    });

    createWindow();

    app.on('activate', () => {
        // macOS：點 Dock 圖示時若沒有視窗則重建
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有視窗關閉時退出（macOS 除外，但我們的應用不需要保持 Dock）
app.on('window-all-closed', () => {
    app.quit();
});

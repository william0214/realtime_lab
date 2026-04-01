import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // 打包時使用相對路徑，讓 Electron 能正確載入
    base: './',
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
    build: {
        // Electron 載入的是本地檔案，使用相對路徑
        outDir: 'dist',
        emptyOutDir: true,
    },
})

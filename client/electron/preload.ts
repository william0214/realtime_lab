import { contextBridge, desktopCapturer } from 'electron';

/**
 * Preload script — 安全地將 Electron API 暴露給 renderer
 * 使用 contextBridge 確保安全隔離
 */
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * 取得可用的螢幕/視窗音訊來源
     * 用於 desktopCapturer 系統音訊擷取
     */
    getDesktopSources: async () => {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            fetchWindowIcons: false,
        });
        // 只回傳必要欄位，避免洩漏敏感資訊
        return sources.map(s => ({
            id: s.id,
            name: s.name,
            displayId: s.display_id,
        }));
    },

    /**
     * 判斷是否在 Electron 環境中
     */
    isElectron: true,

    /**
     * 取得平台資訊
     */
    platform: process.platform,
});

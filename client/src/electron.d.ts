/**
 * Electron API 型別宣告
 * 透過 preload.ts 的 contextBridge 暴露
 */

interface DesktopSource {
    id: string;
    name: string;
    displayId: string;
}

interface ElectronAPI {
    getDesktopSources: () => Promise<DesktopSource[]>;
    isElectron: boolean;
    platform: string;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export {};

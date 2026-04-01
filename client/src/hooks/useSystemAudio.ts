import { useState, useCallback, useRef } from 'react';

/**
 * useSystemAudio — 使用 Electron desktopCapturer 擷取系統音訊
 *
 * 僅在 Electron 環境中有效（靠 window.electronAPI.getDesktopSources）。
 * 瀏覽器環境中 isSupported 為 false，所有操作為 no-op。
 */

interface DesktopSource {
    id: string;
    name: string;
    displayId: string;
}

export interface UseSystemAudioReturn {
    isSupported: boolean;
    sources: DesktopSource[];
    selectedSource: DesktopSource | null;
    stream: MediaStream | null;
    loadSources: () => Promise<void>;
    selectSource: (source: DesktopSource) => Promise<void>;
    stopCapture: () => void;
    error: string | null;
}

export function useSystemAudio(): UseSystemAudioReturn {
    const isSupported = typeof window !== 'undefined' && !!window.electronAPI;

    const [sources, setSources] = useState<DesktopSource[]>([]);
    const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    /** 取得可用的螢幕/視窗來源列表 */
    const loadSources = useCallback(async () => {
        if (!isSupported) return;
        setError(null);
        try {
            const list = await window.electronAPI!.getDesktopSources();
            setSources(list);
        } catch (err) {
            setError(`無法取得音訊來源：${(err as Error).message}`);
        }
    }, [isSupported]);

    /** 選擇來源並開始擷取系統音訊 */
    const selectSource = useCallback(async (source: DesktopSource) => {
        if (!isSupported) return;
        setError(null);

        // 先停止舊的 stream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setStream(null);
        }

        try {
            // Electron 特有的 chromeMediaSource 約束（需要 type cast）
            const constraints = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: source.id,
                    },
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: source.id,
                    },
                },
            } as unknown as MediaStreamConstraints;

            const rawStream = await navigator.mediaDevices.getUserMedia(constraints);

            // 只保留音訊 track，停止視頻 track 節省資源
            rawStream.getVideoTracks().forEach(t => t.stop());

            // 建立只含音訊 track 的乾淨 stream
            const audioStream = new MediaStream(rawStream.getAudioTracks());

            streamRef.current = audioStream;
            setStream(audioStream);
            setSelectedSource(source);

            console.log(`🔊 系統音訊開始擷取: ${source.name} (id=${source.id})`);
        } catch (err) {
            const msg = (err as Error).message;
            console.error('🚨 系統音訊擷取失敗:', err);

            if (msg.includes('Permission denied') || msg.includes('NotAllowed')) {
                setError('系統音訊擷取被拒絕，請確認 Electron 權限設定');
            } else if (msg.includes('NotFound') || msg.includes('Could not start')) {
                setError('找不到指定的音訊來源，請重新選擇');
            } else {
                setError(`系統音訊錯誤：${msg}`);
            }
        }
    }, [isSupported]);

    /** 停止系統音訊擷取並釋放資源 */
    const stopCapture = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setStream(null);
        setSelectedSource(null);
        console.log('🔊 系統音訊擷取停止');
    }, []);

    return {
        isSupported,
        sources,
        selectedSource,
        stream,
        loadSources,
        selectSource,
        stopCapture,
        error,
    };
}

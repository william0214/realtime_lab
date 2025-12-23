import { useState, useRef, useCallback } from 'react';

interface UseRecorderOptions {
    duration?: number; // 錄製時長（毫秒），預設 3000
    onComplete?: (blob: Blob) => void;
}

interface UseRecorderReturn {
    recording: boolean;
    start: () => Promise<void>;
    stop: () => void;
    error: string | null;
}

export function useRecorder(options: UseRecorderOptions = {}): UseRecorderReturn {
    const { duration = 3000, onComplete } = options;

    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timeoutRef = useRef<number | null>(null);

    const stop = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setRecording(false);
    }, []);

    const start = useCallback(async () => {
        setError(null);
        chunksRef.current = [];

        try {
            // 請求麥克風權限
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 24000, // OpenAI Realtime 需要 24kHz
                    channelCount: 1,   // 單聲道
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });

            // 建立 MediaRecorder
            // 使用 webm/opus 格式，之後再轉換為 PCM16
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
            });

            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                // 停止所有音軌
                stream.getTracks().forEach(track => track.stop());

                // 合併所有 chunks 成一個 Blob
                const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
                console.log(`🎤 Recording complete: ${blob.size} bytes`);

                if (onComplete) {
                    onComplete(blob);
                }

                setRecording(false);
            };

            mediaRecorder.onerror = (event) => {
                console.error('🚨 MediaRecorder error:', event);
                setError('錄音發生錯誤');
                stop();
            };

            // 開始錄製
            mediaRecorder.start(100); // 每 100ms 收集一次資料
            setRecording(true);
            console.log(`🎤 Recording started (${duration}ms)`);

            // 設定自動停止計時器
            timeoutRef.current = window.setTimeout(() => {
                console.log('🎤 Recording auto-stop');
                stop();
            }, duration);

        } catch (err) {
            console.error('🚨 Failed to start recording:', err);
            if (err instanceof Error) {
                if (err.name === 'NotAllowedError') {
                    setError('麥克風權限被拒絕');
                } else if (err.name === 'NotFoundError') {
                    setError('找不到麥克風裝置');
                } else {
                    setError(`錄音失敗: ${err.message}`);
                }
            } else {
                setError('錄音失敗');
            }
        }
    }, [duration, onComplete, stop]);

    return {
        recording,
        start,
        stop,
        error,
    };
}

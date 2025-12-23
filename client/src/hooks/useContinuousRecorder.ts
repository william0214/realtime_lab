import { useState, useRef, useCallback } from 'react';

interface UseContinuousRecorderOptions {
    timeslice?: number; // 每隔多少毫秒發送 chunk，預設 300
    onChunk?: (blob: Blob) => void;
    onStop?: () => void;
}

interface UseContinuousRecorderReturn {
    recording: boolean;
    start: () => Promise<void>;
    stop: () => void;
    error: string | null;
}

export function useContinuousRecorder(
    options: UseContinuousRecorderOptions = {}
): UseContinuousRecorderReturn {
    const { timeslice = 300, onChunk, onStop } = options;

    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const stop = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setRecording(false);
        onStop?.();
    }, [onStop]);

    const start = useCallback(async () => {
        setError(null);

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

            streamRef.current = stream;

            // 建立 MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
            });

            mediaRecorderRef.current = mediaRecorder;

            // 每次有資料時發送 chunk
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && onChunk) {
                    console.log(`🎤 Chunk ready: ${event.data.size} bytes`);
                    onChunk(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                console.log('🎤 Recording stopped');
            };

            mediaRecorder.onerror = (event) => {
                console.error('🚨 MediaRecorder error:', event);
                setError('錄音發生錯誤');
                stop();
            };

            // 開始錄音，每 timeslice 毫秒發送一次資料
            mediaRecorder.start(timeslice);
            setRecording(true);
            console.log(`🎤 Recording started (chunk every ${timeslice}ms)`);

        } catch (err) {
            console.error('🚨 Failed to start recording:', err);
            if (err instanceof DOMException) {
                if (err.name === 'NotAllowedError') {
                    setError('請允許麥克風權限');
                } else if (err.name === 'NotFoundError') {
                    setError('找不到麥克風');
                } else {
                    setError(`錄音錯誤: ${err.message}`);
                }
            } else {
                setError('無法啟動錄音');
            }
        }
    }, [timeslice, onChunk, stop]);

    return {
        recording,
        start,
        stop,
        error,
    };
}

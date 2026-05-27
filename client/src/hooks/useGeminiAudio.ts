import { useCallback, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

/**
 * useGeminiAudio
 * 訂閱 Socket.IO 的 gemini:audio_delta 事件，
 * 使用 WebAudio API 即時播放 Gemini Live 回傳的 PCM16 音訊串流。
 *
 * Gemini Live 回傳的音訊格式：
 * - 取樣率：24000 Hz（Gemini TTS 輸出）
 * - 聲道數：1（單聲道）
 * - 格式：PCM16 little-endian，base64 編碼
 */

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

export interface UseGeminiAudioReturn {
    isPlaying: boolean;
    isEnabled: boolean;
    toggleEnabled: () => void;
    bindSocket: (socket: Socket) => void;
    unbindSocket: () => void;
}

export function useGeminiAudio(): UseGeminiAudioReturn {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isEnabled, setIsEnabled] = useState(true);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const nextPlayTimeRef = useRef<number>(0);
    const isEnabledRef = useRef<boolean>(true);
    const socketRef = useRef<Socket | null>(null);

    // 確保 AudioContext 已初始化（需要用戶互動後才能建立）
    const getAudioContext = useCallback((): AudioContext => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
            nextPlayTimeRef.current = 0;
        }
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume();
        }
        return audioCtxRef.current;
    }, []);

    // 將 base64 PCM16 解碼並排程播放
    const playAudioChunk = useCallback((base64Data: string) => {
        if (!isEnabledRef.current) return;

        try {
            const ctx = getAudioContext();

            // base64 → Uint8Array → Int16Array（PCM16 little-endian）
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }

            // PCM16 → Float32（WebAudio 需要 Float32）
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0;
            }

            // 建立 AudioBuffer
            const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE);
            audioBuffer.copyToChannel(float32, 0);

            // 精確排程播放（無縫拼接）
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);

            const now = ctx.currentTime;
            // 確保排程時間不早於現在（防止音訊塊亂序）
            const startTime = Math.max(now, nextPlayTimeRef.current);
            source.start(startTime);

            // 更新下一個塊的開始時間
            nextPlayTimeRef.current = startTime + audioBuffer.duration;

            setIsPlaying(true);

            source.onended = () => {
                // 若排程佇列已空，標記為停止
                const ctx2 = audioCtxRef.current;
                if (ctx2 && nextPlayTimeRef.current <= ctx2.currentTime + 0.05) {
                    setIsPlaying(false);
                }
            };
        } catch (err) {
            console.error('[GeminiAudio] Playback error:', err);
        }
    }, [getAudioContext]);

    const handleAudioDone = useCallback(() => {
        // 音訊串流結束，等待最後一個塊播放完畢
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const remaining = nextPlayTimeRef.current - ctx.currentTime;
        if (remaining > 0) {
            setTimeout(() => setIsPlaying(false), remaining * 1000 + 100);
        } else {
            setIsPlaying(false);
        }
    }, []);

    // 綁定 Socket 事件
    const bindSocket = useCallback((socket: Socket) => {
        if (socketRef.current) {
            socketRef.current.off('gemini:audio_delta');
            socketRef.current.off('gemini:audio_done');
        }
        socketRef.current = socket;
        socket.on('gemini:audio_delta', ({ data }: { data: string }) => {
            playAudioChunk(data);
        });
        socket.on('gemini:audio_done', handleAudioDone);
    }, [playAudioChunk, handleAudioDone]);

    // 解綁 Socket 事件
    const unbindSocket = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.off('gemini:audio_delta');
            socketRef.current.off('gemini:audio_done');
            socketRef.current = null;
        }
    }, []);

    const toggleEnabled = useCallback(() => {
        isEnabledRef.current = !isEnabledRef.current;
        setIsEnabled(isEnabledRef.current);
        if (!isEnabledRef.current) {
            // 停用時暫停 AudioContext
            audioCtxRef.current?.suspend();
            setIsPlaying(false);
        } else {
            audioCtxRef.current?.resume();
        }
    }, []);

    return {
        isPlaying,
        isEnabled,
        toggleEnabled,
        bindSocket,
        unbindSocket,
    };
}

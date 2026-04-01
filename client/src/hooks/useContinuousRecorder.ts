import { useState, useRef, useCallback } from 'react';

export type AudioSource = 'microphone' | 'system' | 'both';

interface UseContinuousRecorderOptions {
    timeslice?: number; // 每隔多少毫秒發送 chunk，預設 300
    audioSource?: AudioSource; // 音訊來源，預設 'microphone'
    externalStream?: MediaStream | null; // 外部 MediaStream（system/both 模式使用）
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
    const { timeslice = 300, audioSource = 'microphone', externalStream, onChunk, onStop } = options;

    const [recording, setRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const stop = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        // 只有在自己持有 stream（非外部 system stream）時才停止 tracks
        if (streamRef.current && audioSource !== 'system') {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setRecording(false);
        onStop?.();
    }, [audioSource, onStop]);

    const start = useCallback(async () => {
        setError(null);

        try {
            let stream: MediaStream;

            if (audioSource === 'system') {
                // 直接使用外部 stream（來自 useSystemAudio）
                if (!externalStream) {
                    setError('未提供系統音訊來源，請先選擇音訊裝置');
                    return;
                }
                stream = externalStream;

            } else if (audioSource === 'both') {
                // 混合麥克風 + 系統音訊
                const micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: 24000,
                        channelCount: 1,
                        echoCancellation: false, // 混音時關閉避免干擾
                        noiseSuppression: false,
                    },
                });

                if (!externalStream) {
                    // 沒有系統音源則降級為純麥克風
                    console.warn('⚠️  system stream 未提供，降級為麥克風模式');
                    stream = micStream;
                } else {
                    // AudioContext 混音
                    const ctx = new AudioContext({ sampleRate: 24000 });
                    const dest = ctx.createMediaStreamDestination();
                    ctx.createMediaStreamSource(micStream).connect(dest);
                    ctx.createMediaStreamSource(externalStream).connect(dest);
                    stream = dest.stream;

                    // 混音完成後停止原始 mic track（dest stream 已擁有音訊）
                    // 保留 micStream tracks 以便 stop() 時一起清理
                    streamRef.current = micStream; // 先存 mic stream 等 stop 清理
                }

            } else {
                // 預設：麥克風
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: 24000, // OpenAI Realtime 需要 24kHz
                        channelCount: 1,   // 單聲道
                        echoCancellation: true,
                        noiseSuppression: true,
                    },
                });
            }

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
                    setError(audioSource === 'system' ? '系統音訊擷取被拒絕' : '請允許麥克風權限');
                } else if (err.name === 'NotFoundError') {
                    setError(audioSource === 'system' ? '找不到系統音訊來源' : '找不到麥克風');
                } else {
                    setError(`錄音錯誤: ${err.message}`);
                }
            } else {
                setError('無法啟動錄音');
            }
        }
    }, [timeslice, audioSource, externalStream, onChunk, stop]);

    return {
        recording,
        start,
        stop,
        error,
    };
}

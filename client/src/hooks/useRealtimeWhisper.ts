/**
 * useRealtimeWhisper.ts
 *
 * 方案 A 混合策略 — 前端 Hook
 *
 * 職責：
 *   1. 連接後端 /rtw Socket.IO 命名空間
 *   2. 初始化 gpt-realtime-whisper Session（透過後端 WS 代理）
 *   3. 使用 AudioWorklet 擷取麥克風 PCM16 音訊並串流至後端
 *   4. 接收 rtw:delta 事件 → 即時更新 partialTranscript（< 100ms 首字）
 *   5. 接收 rtw:speech_stopped 事件 → 通知父元件觸發 Final ASR
 *   6. 接收 rtw:final 事件 → 提供完整轉錄結果（備用）
 *
 * 使用方式：
 *   const {
 *     partialTranscript,   // 即時字幕（gpt-realtime-whisper delta）
 *     isConnected,         // RTW Session 是否就緒
 *     isSpeaking,          // 是否正在說話（Server VAD 偵測）
 *     startStreaming,       // 開始麥克風串流
 *     stopStreaming,        // 停止麥克風串流
 *     updateLanguage,      // 更新辨識語言
 *   } = useRealtimeWhisper({
 *     serverUrl: 'http://localhost:3001',
 *     language: 'zh',
 *     onSpeechStopped: (accumulated) => { ... },  // 觸發 Final ASR
 *     onFinalTranscript: (transcript) => { ... }, // RTW 自己的 final（備用）
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// AudioWorklet 處理器程式碼（inline，避免額外的靜態資源）
const WORKLET_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // 每 100ms 送出一批（24000 Hz × 0.1s = 2400 samples）
    this._flushSize = 2400;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array
    for (let i = 0; i < samples.length; i++) {
      // Float32 → Int16
      const s = Math.max(-1, Math.min(1, samples[i]));
      const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
      this._buffer.push(int16);
      this._bufferSize++;
    }

    if (this._bufferSize >= this._flushSize) {
      const pcm = new Int16Array(this._buffer.splice(0, this._flushSize));
      this._bufferSize -= this._flushSize;
      this.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm16-processor', PCM16Processor);
`;

export interface UseRealtimeWhisperOptions {
  serverUrl: string;
  language?: string;
  onSpeechStopped?: (accumulated: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export interface UseRealtimeWhisperReturn {
  partialTranscript: string;
  isConnected: boolean;
  isSpeaking: boolean;
  isStreaming: boolean;
  startStreaming: () => Promise<void>;
  stopStreaming: () => void;
  updateLanguage: (language: string) => void;
  clearPartial: () => void;
}

export function useRealtimeWhisper(opts: UseRealtimeWhisperOptions): UseRealtimeWhisperReturn {
  const {
    serverUrl,
    language = 'zh',
    onSpeechStopped,
    onFinalTranscript,
    onError,
  } = opts;

  const [partialTranscript, setPartialTranscript] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const languageRef = useRef(language);
  const isStreamingRef = useRef(false);

  // 同步 language ref
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // 建立 Socket.IO 連線
  useEffect(() => {
    const socket = io(`${serverUrl}/rtw`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[RTW] Socket connected, initializing session...');
      socket.emit('rtw:init', { language: languageRef.current });
    });

    socket.on('rtw:ready', () => {
      console.log('[RTW] Session ready');
      setIsConnected(true);
    });

    socket.on('rtw:disconnected', () => {
      console.log('[RTW] Session disconnected');
      setIsConnected(false);
    });

    socket.on('rtw:delta', (data: { delta: string; accumulated: string }) => {
      setPartialTranscript(data.accumulated);
    });

    socket.on('rtw:final', (data: { transcript: string }) => {
      console.log('[RTW] Final transcript:', data.transcript);
      onFinalTranscript?.(data.transcript);
      setPartialTranscript('');
    });

    socket.on('rtw:speech_started', () => {
      console.log('[RTW] Speech started');
      setIsSpeaking(true);
      setPartialTranscript('');
    });

    socket.on('rtw:speech_stopped', (data: { accumulated: string }) => {
      console.log('[RTW] Speech stopped, accumulated:', data.accumulated);
      setIsSpeaking(false);
      onSpeechStopped?.(data.accumulated);
    });

    socket.on('rtw:error', (data: { message: string }) => {
      console.error('[RTW] Error:', data.message);
      onError?.(data.message);
    });

    socket.on('disconnect', () => {
      console.log('[RTW] Socket disconnected');
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  // 建立 AudioWorklet 並開始串流
  const startStreaming = useCallback(async () => {
    if (isStreamingRef.current) return;

    try {
      // 取得麥克風權限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 建立 AudioContext（24kHz，與 gpt-realtime-whisper 相符）
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      // 注入 AudioWorklet 處理器
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      // 建立 WorkletNode
      const workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
      workletNodeRef.current = workletNode;

      // 接收 PCM16 資料並發送至後端
      workletNode.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer }>) => {
        if (!isStreamingRef.current) return;
        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit('rtw:audio', e.data.pcm);
        }
      };

      // 連接音訊管道
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      isStreamingRef.current = true;
      setIsStreaming(true);
      console.log('[RTW] Streaming started (24kHz PCM16)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[RTW] Start streaming error:', msg);
      onError?.(msg);
    }
  }, [onError]);

  // 停止串流
  const stopStreaming = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    console.log('[RTW] Streaming stopped');
  }, []);

  // 更新辨識語言
  const updateLanguage = useCallback((lang: string) => {
    languageRef.current = lang;
    socketRef.current?.emit('rtw:update_lang', { language: lang });
  }, []);

  // 清除 partial transcript
  const clearPartial = useCallback(() => {
    setPartialTranscript('');
  }, []);

  // 元件卸載時清理
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return {
    partialTranscript,
    isConnected,
    isSpeaking,
    isStreaming,
    startStreaming,
    stopStreaming,
    updateLanguage,
    clearPartial,
  };
}

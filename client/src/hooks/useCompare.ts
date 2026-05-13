/**
 * useCompare.ts
 * 三模型並排比較的 React Hook
 * 管理 Socket.IO /compare 命名空間連線、PCM16 音訊串流、結果收集
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// ─── 型別定義 ────────────────────────────────────────────────────────────────
export type ModelKey = 'VOICE_AGENT' | 'TRANSLATE' | 'WHISPER';

export interface ModelLatency {
  firstTranscriptDelta?: number;
  transcriptComplete?: number;
  firstTranslationDelta?: number;
  translationComplete?: number;
}

export interface ModelResult {
  model: ModelKey;
  modelId: string;
  transcriptDelta?: string;
  transcriptAccumulated: string;
  transcriptFinal?: string;
  translationDelta?: string;
  translationFinal?: string;
  latency: ModelLatency;
  connected: boolean;
  error?: string;
}

export interface ModelState {
  modelKey: ModelKey;
  modelId: string;
  label: string;
  description: string;
  connected: boolean;
  transcriptLive: string;      // 累積即時字幕
  transcriptFinal: string;     // 最終字幕
  translationLive: string;     // 累積即時翻譯
  translationFinal: string;    // 最終翻譯
  latency: ModelLatency;
  error?: string;
  // 歷史紀錄
  history: HistoryEntry[];
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  transcript: string;
  translation?: string;
  latency: ModelLatency;
  rating?: number;  // 1-5 星評分
}

export type CompareStatus = 'idle' | 'connecting' | 'ready' | 'recording' | 'error';

// ─── 模型標籤與說明 ──────────────────────────────────────────────────────────
const MODEL_META: Record<ModelKey, { label: string; description: string; modelId: string }> = {
  VOICE_AGENT: {
    label: 'gpt-realtime-2',
    description: 'Voice Agent — 語音助理模式，支援 Function Calling，可自訂翻譯 Prompt',
    modelId: 'gpt-realtime-2',
  },
  TRANSLATE: {
    label: 'gpt-realtime-translate',
    description: 'Live Translation — 專用翻譯模型，70+ 語言輸入，13 種輸出語言，含翻譯語音',
    modelId: 'gpt-realtime-translate',
  },
  WHISPER: {
    label: 'gpt-realtime-whisper',
    description: 'Realtime Whisper — 純轉錄模型，最低延遲串流字幕，可調 0.4-3.0s 延遲',
    modelId: 'gpt-realtime-whisper',
  },
};

const INITIAL_MODEL_STATE = (key: ModelKey): ModelState => ({
  modelKey: key,
  modelId: MODEL_META[key].modelId,
  label: MODEL_META[key].label,
  description: MODEL_META[key].description,
  connected: false,
  transcriptLive: '',
  transcriptFinal: '',
  translationLive: '',
  translationFinal: '',
  latency: {},
  history: [],
});

// ─── Hook ────────────────────────────────────────────────────────────────────
interface UseCompareOptions {
  serverUrl?: string;
  sourceLang?: string;
  targetLang?: string;
}

export function useCompare(options: UseCompareOptions = {}) {
  const {
    serverUrl = 'http://localhost:3001',
    sourceLang: initSource = 'zh-TW',
    targetLang: initTarget = 'en',
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechStartTimeRef = useRef<number | null>(null);

  const [status, setStatus] = useState<CompareStatus>('idle');
  const [sourceLang, setSourceLang] = useState(initSource);
  const [targetLang, setTargetLang] = useState(initTarget);
  const [models, setModels] = useState<Record<ModelKey, ModelState>>({
    VOICE_AGENT: INITIAL_MODEL_STATE('VOICE_AGENT'),
    TRANSLATE:   INITIAL_MODEL_STATE('TRANSLATE'),
    WHISPER:     INITIAL_MODEL_STATE('WHISPER'),
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  // ── Socket.IO 連線 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(`${serverUrl}/compare`, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Compare] Socket connected');
    });

    socket.on('compare:ready', (data: { success: ModelKey[]; failed: ModelKey[]; sourceLang: string; targetLang: string }) => {
      setStatus('ready');
      setModels(prev => {
        const next = { ...prev };
        for (const key of data.success) {
          next[key] = { ...next[key], connected: true, error: undefined };
        }
        for (const key of data.failed) {
          next[key] = { ...next[key], connected: false };
        }
        return next;
      });
    });

    socket.on('compare:result', (result: ModelResult) => {
      setModels(prev => {
        const key = result.model;
        const cur = prev[key];

        // 合併延遲數據
        const latency: ModelLatency = {
          ...cur.latency,
          ...Object.fromEntries(
            Object.entries(result.latency).filter(([, v]) => v !== undefined)
          ),
        };

        let transcriptLive = cur.transcriptLive;
        let transcriptFinal = cur.transcriptFinal;
        let translationLive = cur.translationLive;
        let translationFinal = cur.translationFinal;
        const newHistory = [...cur.history];

        if (result.transcriptDelta) {
          transcriptLive = result.transcriptAccumulated;
        }
        if (result.transcriptFinal) {
          transcriptFinal = result.transcriptFinal;
          transcriptLive = result.transcriptFinal;
        }
        if (result.translationDelta) {
          translationLive = (translationLive || '') + result.translationDelta;
        }
        if (result.translationFinal) {
          translationFinal = result.translationFinal;
          translationLive = result.translationFinal;
          // 加入歷史
          const entry: HistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            transcript: transcriptFinal || transcriptLive,
            translation: result.translationFinal,
            latency,
          };
          newHistory.push(entry);
        } else if (result.transcriptFinal && key === 'WHISPER') {
          // WHISPER 只有字幕，沒有翻譯
          const entry: HistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            transcript: result.transcriptFinal,
            latency,
          };
          newHistory.push(entry);
        }

        return {
          ...prev,
          [key]: {
            ...cur,
            transcriptLive,
            transcriptFinal,
            translationLive,
            translationFinal,
            latency,
            error: result.error,
            history: newHistory,
          },
        };
      });
    });

    socket.on('compare:speech_started', () => {
      speechStartTimeRef.current = Date.now();
      // 清空即時顯示
      setModels(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next) as ModelKey[]) {
          next[key] = {
            ...next[key],
            transcriptLive: '',
            translationLive: '',
          };
        }
        return next;
      });
    });

    socket.on('compare:model_error', (info: { model: ModelKey; error: string }) => {
      setModels(prev => ({
        ...prev,
        [info.model]: { ...prev[info.model], error: info.error },
      }));
    });

    socket.on('compare:error', (data: { message: string }) => {
      setErrorMsg(data.message);
      setStatus('error');
    });

    socket.on('disconnect', () => {
      setStatus('idle');
    });

    return () => {
      socket.disconnect();
    };
  }, [serverUrl]);

  // ── 初始化三模型 ───────────────────────────────────────────────────────────
  const initCompare = useCallback(() => {
    if (!socketRef.current) return;
    setStatus('connecting');
    setErrorMsg(null);
    // 重置所有模型狀態
    setModels({
      VOICE_AGENT: INITIAL_MODEL_STATE('VOICE_AGENT'),
      TRANSLATE:   INITIAL_MODEL_STATE('TRANSLATE'),
      WHISPER:     INITIAL_MODEL_STATE('WHISPER'),
    });
    socketRef.current.emit('compare:init', { sourceLang, targetLang });
  }, [sourceLang, targetLang]);

  // ── 更新語言 ───────────────────────────────────────────────────────────────
  const updateLanguages = useCallback((src: string, tgt: string) => {
    setSourceLang(src);
    setTargetLang(tgt);
    socketRef.current?.emit('compare:update_lang', { sourceLang: src, targetLang: tgt });
  }, []);

  // ── 開始錄音（PCM16 via AudioWorklet / ScriptProcessor） ──────────────────
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor（相容性最佳）
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let isSpeaking = false;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // 簡易能量 VAD
        let energy = 0;
        for (let i = 0; i < inputData.length; i++) {
          energy += inputData[i] * inputData[i];
        }
        energy = Math.sqrt(energy / inputData.length);

        if (energy > 0.01 && !isSpeaking) {
          isSpeaking = true;
          socketRef.current?.emit('compare:speech_start');
        } else if (energy < 0.005 && isSpeaking) {
          isSpeaking = false;
        }

        // Float32 → PCM16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        socketRef.current?.emit('compare:audio', pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsRecording(true);
      setStatus('recording');
    } catch (err) {
      setErrorMsg(`麥克風錯誤: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [isRecording]);

  // ── 停止錄音 ───────────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setStatus('ready');
  }, []);

  // ── 評分歷史條目 ───────────────────────────────────────────────────────────
  const rateEntry = useCallback((modelKey: ModelKey, entryId: string, rating: number) => {
    setModels(prev => {
      const model = prev[modelKey];
      const history = model.history.map(h =>
        h.id === entryId ? { ...h, rating } : h
      );
      return { ...prev, [modelKey]: { ...model, history } };
    });
  }, []);

  // ── 清除歷史 ───────────────────────────────────────────────────────────────
  const clearHistory = useCallback(() => {
    setModels(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ModelKey[]) {
        next[key] = { ...next[key], history: [], transcriptLive: '', transcriptFinal: '', translationLive: '', translationFinal: '' };
      }
      return next;
    });
  }, []);

  // ── 匯出 JSON ──────────────────────────────────────────────────────────────
  const exportSession = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      sourceLang,
      targetLang,
      models: Object.values(models).map(m => ({
        model: m.modelKey,
        modelId: m.modelId,
        history: m.history,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `realtime-compare-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [models, sourceLang, targetLang]);

  return {
    status,
    sourceLang,
    targetLang,
    models,
    isRecording,
    errorMsg,
    initCompare,
    updateLanguages,
    startRecording,
    stopRecording,
    rateEntry,
    clearHistory,
    exportSession,
  };
}

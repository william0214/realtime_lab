/**
 * tripleCompare.ts
 * 三模型並排比較核心
 * 同一份 PCM16 音訊同時送進三個 OpenAI Realtime 模型：
 *   - gpt-realtime-2       → /v1/realtime          (Voice Agent)
 *   - gpt-realtime-translate → /v1/realtime/translations (Live Translation)
 *   - gpt-realtime-whisper → /v1/realtime/transcription_sessions (Transcription)
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// ─── 模型常數 ────────────────────────────────────────────────────────────────
export const MODELS = {
  VOICE_AGENT:  'gpt-realtime-2',
  TRANSLATE:    'gpt-realtime-translate',
  WHISPER:      'gpt-realtime-whisper',
} as const;

export type ModelKey = keyof typeof MODELS;
export type ModelId  = typeof MODELS[ModelKey];

// ─── 端點常數 ────────────────────────────────────────────────────────────────
const ENDPOINTS: Record<ModelKey, string> = {
  VOICE_AGENT: 'wss://api.openai.com/v1/realtime',
  TRANSLATE:   'wss://api.openai.com/v1/realtime/translations',
  WHISPER:     'wss://api.openai.com/v1/realtime/transcription_sessions',
};

// ─── 型別定義 ────────────────────────────────────────────────────────────────
export interface CompareSessionConfig {
  apiKey: string;
  sourceLang: string;   // e.g. 'zh-TW'
  targetLang: string;   // e.g. 'en'
  vadThreshold?: number;
  silenceDurationMs?: number;
}

export interface ModelResult {
  model: ModelKey;
  modelId: ModelId;
  /** 即時字幕 delta（逐字） */
  transcriptDelta?: string;
  /** 累積字幕 */
  transcriptAccumulated: string;
  /** 最終字幕 */
  transcriptFinal?: string;
  /** 翻譯結果（僅 VOICE_AGENT / TRANSLATE 有） */
  translationDelta?: string;
  translationFinal?: string;
  /** 延遲數據（ms） */
  latency: {
    firstTranscriptDelta?: number;   // 首字延遲
    transcriptComplete?: number;     // 字幕完成延遲
    firstTranslationDelta?: number;  // 翻譯首字延遲
    translationComplete?: number;    // 翻譯完成延遲
  };
  /** 連線狀態 */
  connected: boolean;
  error?: string;
}

// ─── 單一模型 Session ────────────────────────────────────────────────────────
class ModelSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private modelKey: ModelKey;
  private modelId: ModelId;
  private endpoint: string;
  private sourceLang: string;
  private targetLang: string;
  private vadThreshold: number;
  private silenceDurationMs: number;

  public isConnected = false;
  private transcriptBuffer = '';
  private translationBuffer = '';
  private speechStartTime: number | null = null;

  // 延遲計時
  private firstTranscriptDeltaTime: number | null = null;
  private firstTranslationDeltaTime: number | null = null;

  constructor(modelKey: ModelKey, config: CompareSessionConfig) {
    super();
    this.modelKey    = modelKey;
    this.modelId     = MODELS[modelKey];
    this.endpoint    = ENDPOINTS[modelKey];
    this.apiKey      = config.apiKey;
    this.sourceLang  = config.sourceLang;
    this.targetLang  = config.targetLang;
    this.vadThreshold    = config.vadThreshold    ?? 0.3;
    this.silenceDurationMs = config.silenceDurationMs ?? 500;
  }

  getModelKey(): ModelKey { return this.modelKey; }
  getModelId():  ModelId  { return this.modelId;  }

  // 將語言代碼轉為 Whisper 格式
  private toWhisperLang(lang: string): string {
    const map: Record<string, string> = {
      'zh-TW': 'zh', 'zh-CN': 'zh', 'en': 'en', 'ja': 'ja',
      'ko': 'ko', 'vi': 'vi', 'id': 'id', 'th': 'th',
    };
    return map[lang] ?? lang.split('-')[0];
  }

  // 建立 session.update payload（依模型類型不同）
  private buildSessionUpdate(): object {
    const whisperLang = this.toWhisperLang(this.sourceLang);

    if (this.modelKey === 'VOICE_AGENT') {
      return {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: [
            `你是一個即時口語翻譯助手。`,
            `說話者語言：${this.sourceLang}，目標語言：${this.targetLang}。`,
            `先辨識語音，再翻譯成目標語言。回應要簡短自然。`,
            `若輸入是繁體中文，請翻譯成${this.targetLang}；若輸入是${this.targetLang}，請翻譯成繁體中文。`,
          ].join('\n'),
          input_audio_transcription: {
            model: 'gpt-4o-mini-transcribe',
            language: whisperLang,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: this.vadThreshold,
            silence_duration_ms: this.silenceDurationMs,
            create_response: true,
            interrupt_response: true,
          },
        },
      };
    }

    if (this.modelKey === 'TRANSLATE') {
      // gpt-realtime-translate 使用 translation session 格式
      return {
        type: 'session.update',
        session: {
          input_audio_transcription: { enabled: true },
          translation: {
            target_language: this.targetLang.split('-')[0].toLowerCase(),
          },
          turn_detection: {
            type: 'server_vad',
            threshold: this.vadThreshold,
            silence_duration_ms: this.silenceDurationMs,
          },
        },
      };
    }

    // WHISPER: transcription session
    return {
      type: 'session.update',
      session: {
        input_audio_transcription: {
          model: 'gpt-realtime-whisper',
          language: whisperLang,
        },
        turn_detection: {
          type: 'server_vad',
          threshold: this.vadThreshold,
          silence_duration_ms: this.silenceDurationMs,
        },
      },
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.endpoint}?model=${this.modelId}`;
      console.log(`[${this.modelKey}] Connecting to ${url}`);

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error(`[${this.modelKey}] Connection timeout`));
      }, 15000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        console.log(`[${this.modelKey}] ✅ Connected`);
        // 初始化 session
        this.send(this.buildSessionUpdate());
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch (e) {
          console.error(`[${this.modelKey}] Parse error:`, e);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[${this.modelKey}] ❌ Error:`, err.message);
        this.isConnected = false;
        this.emit('error', err.message);
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        console.log(`[${this.modelKey}] Disconnected: ${code} ${reason}`);
        this.emit('disconnected', { code, reason: reason.toString() });
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  sendAudio(pcm16Buffer: Buffer): void {
    if (!this.isConnected || !this.ws) return;
    const base64 = pcm16Buffer.toString('base64');
    this.send({ type: 'input_audio_buffer.append', audio: base64 });
  }

  markSpeechStart(): void {
    this.speechStartTime = Date.now();
    this.transcriptBuffer = '';
    this.translationBuffer = '';
    this.firstTranscriptDeltaTime = null;
    this.firstTranslationDeltaTime = null;
    this.emit('speech_started');
  }

  private send(payload: object): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleEvent(event: { type: string; [k: string]: unknown }): void {
    const now = Date.now();

    switch (event.type) {
      // ── 語音開始 ──────────────────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.markSpeechStart();
        break;

      case 'input_audio_buffer.speech_stopped':
        this.emit('speech_stopped');
        break;

      // ── 字幕 Delta（WHISPER 與 VOICE_AGENT） ─────────────────────────────
      case 'conversation.item.input_audio_transcription.delta': {
        const delta = (event.delta as string) ?? '';
        if (!delta) break;
        if (this.firstTranscriptDeltaTime === null && this.speechStartTime) {
          this.firstTranscriptDeltaTime = now - this.speechStartTime;
        }
        this.transcriptBuffer += delta;
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptDelta: delta,
          transcriptAccumulated: this.transcriptBuffer,
          latency: {
            firstTranscriptDelta: this.firstTranscriptDeltaTime ?? undefined,
          },
          connected: true,
        } as ModelResult);
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript as string) ?? this.transcriptBuffer;
        const completedLatency = this.speechStartTime ? now - this.speechStartTime : undefined;
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptFinal: transcript,
          transcriptAccumulated: transcript,
          latency: {
            firstTranscriptDelta: this.firstTranscriptDeltaTime ?? undefined,
            transcriptComplete: completedLatency,
          },
          connected: true,
        } as ModelResult);
        this.transcriptBuffer = '';
        break;
      }

      // ── TRANSLATE 模型的翻譯輸出 ──────────────────────────────────────────
      case 'translation.text.delta': {
        const delta = (event.delta as string) ?? '';
        if (!delta) break;
        if (this.firstTranslationDeltaTime === null && this.speechStartTime) {
          this.firstTranslationDeltaTime = now - this.speechStartTime;
        }
        this.translationBuffer += delta;
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptAccumulated: this.transcriptBuffer,
          translationDelta: delta,
          latency: {
            firstTranslationDelta: this.firstTranslationDeltaTime ?? undefined,
          },
          connected: true,
        } as ModelResult);
        break;
      }

      case 'translation.text.done': {
        const translation = (event.text as string) ?? this.translationBuffer;
        const completedLatency = this.speechStartTime ? now - this.speechStartTime : undefined;
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptAccumulated: this.transcriptBuffer,
          translationFinal: translation,
          latency: {
            firstTranslationDelta: this.firstTranslationDeltaTime ?? undefined,
            translationComplete: completedLatency,
          },
          connected: true,
        } as ModelResult);
        this.translationBuffer = '';
        break;
      }

      // ── VOICE_AGENT 的文字回應（翻譯） ───────────────────────────────────
      case 'response.text.delta': {
        const delta = (event.delta as string) ?? '';
        if (!delta) break;
        if (this.firstTranslationDeltaTime === null && this.speechStartTime) {
          this.firstTranslationDeltaTime = now - this.speechStartTime;
        }
        this.translationBuffer += delta;
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptAccumulated: this.transcriptBuffer,
          translationDelta: delta,
          latency: {
            firstTranslationDelta: this.firstTranslationDeltaTime ?? undefined,
          },
          connected: true,
        } as ModelResult);
        break;
      }

      case 'response.done': {
        const resp = event.response as {
          output?: Array<{ content?: Array<{ type?: string; text?: string; transcript?: string }> }>;
        };
        const outputs = resp?.output ?? [];
        let finalText = '';
        for (const out of outputs) {
          for (const c of out.content ?? []) {
            if (c.type === 'text' && c.text) finalText = c.text;
            if (c.type === 'audio' && c.transcript) finalText = c.transcript;
          }
        }
        if (finalText) {
          const completedLatency = this.speechStartTime ? now - this.speechStartTime : undefined;
          this.emit('result', {
            model: this.modelKey,
            modelId: this.modelId,
            transcriptAccumulated: this.transcriptBuffer,
            translationFinal: finalText,
            latency: {
              firstTranslationDelta: this.firstTranslationDeltaTime ?? undefined,
              translationComplete: completedLatency,
            },
            connected: true,
          } as ModelResult);
        }
        this.translationBuffer = '';
        break;
      }

      case 'error': {
        const errMsg = (event.error as { message?: string })?.message ?? 'Unknown error';
        console.error(`[${this.modelKey}] API Error:`, errMsg);
        this.emit('result', {
          model: this.modelKey,
          modelId: this.modelId,
          transcriptAccumulated: this.transcriptBuffer,
          latency: {},
          connected: true,
          error: errMsg,
        } as ModelResult);
        break;
      }

      default:
        // 忽略其他事件（rate_limits, session.created 等）
        break;
    }
  }
}

// ─── 三模型比較管理器 ────────────────────────────────────────────────────────
export class TripleCompareManager extends EventEmitter {
  private sessions: Map<ModelKey, ModelSession> = new Map();
  private config: CompareSessionConfig;

  constructor(config: CompareSessionConfig) {
    super();
    this.config = config;
  }

  /**
   * 同時連接三個模型
   * 若某個模型連線失敗，仍繼續其他模型（不中斷整體流程）
   */
  async connectAll(): Promise<{ success: ModelKey[]; failed: ModelKey[] }> {
    const keys: ModelKey[] = ['VOICE_AGENT', 'TRANSLATE', 'WHISPER'];
    const success: ModelKey[] = [];
    const failed: ModelKey[] = [];

    await Promise.allSettled(
      keys.map(async (key) => {
        const session = new ModelSession(key, this.config);

        session.on('result', (result: ModelResult) => {
          this.emit('model_result', result);
        });
        session.on('speech_started', () => {
          this.emit('speech_started', key);
        });
        session.on('speech_stopped', () => {
          this.emit('speech_stopped', key);
        });
        session.on('error', (err: string) => {
          this.emit('model_error', { model: key, error: err });
        });
        session.on('disconnected', (info: { code: number; reason: string }) => {
          this.emit('model_disconnected', { model: key, ...info });
        });

        try {
          await session.connect();
          this.sessions.set(key, session);
          success.push(key);
        } catch (err) {
          console.error(`[TripleCompare] Failed to connect ${key}:`, err);
          failed.push(key);
          // 發出錯誤結果讓前端知道該欄位不可用
          this.emit('model_result', {
            model: key,
            modelId: MODELS[key],
            transcriptAccumulated: '',
            latency: {},
            connected: false,
            error: err instanceof Error ? err.message : String(err),
          } as ModelResult);
        }
      })
    );

    return { success, failed };
  }

  /**
   * 廣播 PCM16 音訊到所有已連線的模型
   */
  broadcastAudio(pcm16Buffer: Buffer): void {
    for (const [, session] of this.sessions) {
      if (session.isConnected) {
        session.sendAudio(pcm16Buffer);
      }
    }
  }

  /**
   * 通知所有模型語音開始（用於延遲計時起點）
   */
  broadcastSpeechStart(): void {
    for (const [, session] of this.sessions) {
      session.markSpeechStart();
    }
  }

  /**
   * 更新語言設定（重新建立 session）
   */
  updateLanguages(sourceLang: string, targetLang: string): void {
    this.config.sourceLang = sourceLang;
    this.config.targetLang = targetLang;
    // 重連所有 session 以套用新語言
    this.disconnectAll().then(() => this.connectAll());
  }

  /**
   * 取得所有模型連線狀態
   */
  getStatus(): Record<ModelKey, boolean> {
    return {
      VOICE_AGENT: this.sessions.get('VOICE_AGENT')?.isConnected ?? false,
      TRANSLATE:   this.sessions.get('TRANSLATE')?.isConnected   ?? false,
      WHISPER:     this.sessions.get('WHISPER')?.isConnected      ?? false,
    };
  }

  async disconnectAll(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.disconnect();
    }
    this.sessions.clear();
  }
}

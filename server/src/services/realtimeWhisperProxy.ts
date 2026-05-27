/**
 * realtimeWhisperProxy.ts
 *
 * 方案 A 混合策略 — 後端服務層
 *
 * 職責：
 *   1. 提供 Ephemeral Token API（前端 WebRTC 直連用）
 *   2. 提供 WebSocket 代理（伺服器端 WS 管道，用於非 WebRTC 環境）
 *   3. 管理每個 Socket.IO 連線的 gpt-realtime-whisper Session
 *   4. 將 transcript.delta 事件轉發給前端（Socket.IO）
 *   5. 將 speech_stopped 事件通知後端，觸發 Final ASR 流程
 *
 * 架構：
 *   前端 ──WebRTC──→ OpenAI gpt-realtime-whisper（transcript.delta → 前端直收）
 *   前端 ──Socket.IO 'rtw:audio'──→ 後端 realtimeWhisperProxy ──WS──→ OpenAI
 *   OpenAI ──transcript.delta──→ 後端 ──Socket.IO 'rtw:delta'──→ 前端
 *   OpenAI ──speech_stopped──→ 後端 ──觸發 Final ASR──→ 翻譯 → TTS
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import OpenAI from 'openai';

const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

// ─── Ephemeral Token ──────────────────────────────────────────────────────────

export interface EphemeralTokenResult {
  clientSecret: string;
  expiresAt: number;  // Unix timestamp (ms)
}

/**
 * 向 OpenAI 取得 Ephemeral Token（供前端 WebRTC 直連使用）
 * Token 有效期 60 秒
 */
export async function getEphemeralToken(
  apiKey: string,
  language: string = 'zh',
): Promise<EphemeralTokenResult> {
  const openai = new OpenAI({ apiKey });

  // POST /v1/realtime/sessions
  const response = await (openai as unknown as {
    post: (path: string, body: Record<string, unknown>) => Promise<{
      client_secret: { value: string; expires_at: number };
    }>;
  }).post('/v1/realtime/sessions', {
    model: 'gpt-realtime-whisper',
    intent: 'transcription',
    input_audio_format: 'pcm16',
    input_audio_transcription: {
      model: 'gpt-realtime-whisper',
      language,
    },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.4,
      silence_duration_ms: 600,
      prefix_padding_ms: 200,
    },
  });

  return {
    clientSecret: response.client_secret.value,
    expiresAt: response.client_secret.expires_at * 1000,
  };
}

// ─── WebSocket 代理 Session ───────────────────────────────────────────────────

export interface RealtimeWhisperSessionOptions {
  apiKey: string;
  language?: string;
  onDelta: (delta: string, sessionId: string) => void;
  onFinal: (transcript: string, sessionId: string) => void;
  onSpeechStarted: (sessionId: string) => void;
  onSpeechStopped: (sessionId: string) => void;
  onError: (error: string, sessionId: string) => void;
  onConnected: (sessionId: string) => void;
  onDisconnected: (sessionId: string) => void;
}

/**
 * 管理單一 Socket.IO 連線對應的 gpt-realtime-whisper WebSocket Session
 */
export class RealtimeWhisperSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private opts: RealtimeWhisperSessionOptions;
  private isReady = false;
  private partialTranscript = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(sessionId: string, opts: RealtimeWhisperSessionOptions) {
    super();
    this.sessionId = sessionId;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    if (this.isDestroyed) return;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_WS_URL, {
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 15000);

      ws.on('open', () => {
        console.log(`[RTW:${this.sessionId}] WebSocket connected`);
        // 送出 session.update 設定轉錄模式
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                  model: 'gpt-realtime-whisper',
                  language: this.opts.language || 'zh',
                  delay: 'low',
                },
              },
            },
          },
        }));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event, resolve, reject, timeout);
        } catch (e) {
          console.error(`[RTW:${this.sessionId}] Parse error:`, e);
        }
      });

      ws.on('error', (err) => {
        console.error(`[RTW:${this.sessionId}] WS error:`, err.message);
        clearTimeout(timeout);
        this.opts.onError(err.message, this.sessionId);
        if (!this.isReady) reject(err);
      });

      ws.on('close', (code, reason) => {
        console.log(`[RTW:${this.sessionId}] WS closed: ${code} ${reason}`);
        this.isReady = false;
        this.opts.onDisconnected(this.sessionId);
        // 自動重連（非主動銷毀時）
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private handleEvent(
    event: Record<string, unknown>,
    resolve: (v: void) => void,
    reject: (e: Error) => void,
    timeout: NodeJS.Timeout,
  ) {
    switch (event.type) {
      case 'session.created':
        console.log(`[RTW:${this.sessionId}] session.created`);
        break;

      case 'session.updated':
        console.log(`[RTW:${this.sessionId}] session.updated — ready`);
        this.isReady = true;
        clearTimeout(timeout);
        this.opts.onConnected(this.sessionId);
        resolve();
        break;

      case 'input_audio_buffer.speech_started':
        console.log(`[RTW:${this.sessionId}] speech_started`);
        this.partialTranscript = '';
        this.opts.onSpeechStarted(this.sessionId);
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log(`[RTW:${this.sessionId}] speech_stopped`);
        this.opts.onSpeechStopped(this.sessionId);
        break;

      case 'conversation.item.input_audio_transcription.delta': {
        const delta = (event.delta as string) || '';
        if (delta) {
          this.partialTranscript += delta;
          this.opts.onDelta(delta, this.sessionId);
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript as string) || this.partialTranscript;
        if (transcript.trim()) {
          this.opts.onFinal(transcript, this.sessionId);
        }
        this.partialTranscript = '';
        break;
      }

      case 'error': {
        const errMsg = (event.error as { message?: string })?.message || 'Unknown error';
        console.error(`[RTW:${this.sessionId}] API error:`, errMsg);
        this.opts.onError(errMsg, this.sessionId);
        if (!this.isReady) {
          clearTimeout(timeout);
          reject(new Error(errMsg));
        }
        break;
      }
    }
  }

  /**
   * 傳送 PCM16 音訊資料（Base64 編碼）
   */
  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    }));
  }

  /**
   * 手動 commit（關閉 Server VAD 時使用）
   */
  commit(): void {
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  /**
   * 更新語言設定（需重建 session）
   */
  async updateLanguage(language: string): Promise<void> {
    this.opts = { ...this.opts, language };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: {
                model: 'gpt-realtime-whisper',
                language,
                delay: 'low',
              },
            },
          },
        },
      }));
    }
  }

  private scheduleReconnect(delayMs = 2000): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (this.isDestroyed) return;
      console.log(`[RTW:${this.sessionId}] Reconnecting...`);
      try {
        await this.connect();
      } catch (e) {
        console.error(`[RTW:${this.sessionId}] Reconnect failed:`, e);
        this.scheduleReconnect(Math.min(delayMs * 2, 16000));
      }
    }, delayMs);
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close(1000, 'Session destroyed');
      this.ws = null;
    }
    this.isReady = false;
  }

  get ready(): boolean { return this.isReady; }
  get id(): string { return this.sessionId; }
}

// ─── Session 管理器 ────────────────────────────────────────────────────────────

/**
 * 管理所有 Socket.IO 連線的 RealtimeWhisperSession
 */
export class RealtimeWhisperManager {
  private sessions = new Map<string, RealtimeWhisperSession>();
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createSession(
    socketId: string,
    language: string,
    callbacks: Omit<RealtimeWhisperSessionOptions, 'apiKey' | 'language'>,
  ): Promise<RealtimeWhisperSession> {
    // 銷毀舊 session（如果存在）
    this.destroySession(socketId);

    const session = new RealtimeWhisperSession(socketId, {
      apiKey: this.apiKey,
      language,
      ...callbacks,
    });

    this.sessions.set(socketId, session);
    await session.connect();
    return session;
  }

  getSession(socketId: string): RealtimeWhisperSession | undefined {
    return this.sessions.get(socketId);
  }

  destroySession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      session.destroy();
      this.sessions.delete(socketId);
    }
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }

  get size(): number { return this.sessions.size; }
}

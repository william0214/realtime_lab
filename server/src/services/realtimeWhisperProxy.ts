/**
 * realtimeWhisperProxy.ts
 *
 * 方案 A 混合策略 — 後端服務層（含 WarmPool 連線池優化）
 *
 * 職責：
 *   1. WarmPool：伺服器啟動時預建並維持 idle WS 連線，消除 TLS 握手開銷
 *   2. 提供 WebSocket 代理（伺服器端 WS 管道，用於非 WebRTC 環境）
 *   3. 管理每個 Socket.IO 連線的 gpt-realtime-whisper Session
 *   4. 將 transcript.delta 事件轉發給前端（Socket.IO）
 *   5. 將 speech_stopped 事件通知後端，觸發 Final ASR 流程
 *
 * 架構：
 *   [WarmPool] 預建 N 條 idle WS 連線（session.updated 完成後進入 idle 狀態）
 *   前端 ──Socket.IO 'rtw:init'──→ 後端從 WarmPool 取出 idle 連線 → 立即 ready
 *   前端 ──Socket.IO 'rtw:audio'──→ 後端 realtimeWhisperProxy ──WS──→ OpenAI
 *   OpenAI ──transcript.delta──→ 後端 ──Socket.IO 'rtw:delta'──→ 前端
 *   OpenAI ──speech_stopped──→ 後端 ──觸發 Final ASR──→ 翻譯 → TTS
 *
 * 延遲優化效益：
 *   優化前：rtw:init → rtw:ready = ~1,183ms（含 WS 握手 700ms + session.updated 220ms）
 *   優化後：rtw:init → rtw:ready = ~10ms（直接從 pool 取出已就緒的連線）
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

// ─── 工具：建立 session.update payload ──────────────────────────────────────

function makeSessionUpdatePayload(language: string) {
  return JSON.stringify({
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
  });
}

// ─── WarmPool：預建 idle WebSocket 連線 ─────────────────────────────────────

interface IdleConnection {
  ws: WebSocket;
  language: string;
  readyAt: number;  // 連線就緒的時間戳（ms）
}

/**
 * WarmPool 管理預建的 idle WebSocket 連線
 *
 * 設計原則：
 * - 伺服器啟動後立即填充 poolSize 條連線
 * - 每條連線完成 session.updated 後進入 idle 狀態
 * - 使用者請求時直接取出，補充一條新連線到 pool
 * - 連線閒置超過 maxIdleMs 自動替換（OpenAI 可能關閉長時間 idle 連線）
 * - 連線斷線時自動補充
 */
export class WarmPool {
  private pool: IdleConnection[] = [];
  private apiKey: string;
  private defaultLanguage: string;
  private poolSize: number;
  private maxIdleMs: number;
  private refillTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(opts: {
    apiKey: string;
    defaultLanguage?: string;
    poolSize?: number;
    maxIdleMs?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.defaultLanguage = opts.defaultLanguage ?? 'zh';
    this.poolSize = opts.poolSize ?? 2;
    this.maxIdleMs = opts.maxIdleMs ?? 120_000; // 2 分鐘
  }

  /**
   * 啟動 WarmPool，預建連線
   */
  async start(): Promise<void> {
    console.log(`[WarmPool] Starting with poolSize=${this.poolSize}, language=${this.defaultLanguage}`);
    const promises = Array.from({ length: this.poolSize }, () => this.addConnection());
    await Promise.allSettled(promises);
    console.log(`[WarmPool] Ready — ${this.pool.length}/${this.poolSize} connections warm`);
    this.scheduleRefill();
  }

  /**
   * 從 pool 取出一條 idle 連線
   * 若 pool 為空，建立一條新連線（fallback，有延遲）
   * 取出後立即補充一條新連線
   */
  async acquire(language: string): Promise<WebSocket> {
    // 清理過期連線
    this.evictExpired();

    // 嘗試從 pool 取出語言匹配的連線
    const idx = this.pool.findIndex(c => c.language === language);
    let conn: IdleConnection | undefined;

    if (idx !== -1) {
      conn = this.pool.splice(idx, 1)[0];
    } else if (this.pool.length > 0) {
      // 取出任意連線，重新設定語言
      conn = this.pool.shift();
    }

    if (conn) {
      const waitMs = Date.now() - conn.readyAt;
      console.log(`[WarmPool] Acquired warm connection (idle ${waitMs}ms, lang=${conn.language})`);
      // 語言不同時重新送 session.update
      if (conn.language !== language) {
        conn.ws.send(makeSessionUpdatePayload(language));
        // 等待 session.updated（最多 500ms）
        await this.waitForSessionUpdated(conn.ws, 500).catch(() => {
          console.warn('[WarmPool] session.update timeout after language change');
        });
      }
      // 立即補充一條新連線
      this.addConnection().catch(e => console.warn('[WarmPool] Refill failed:', e.message));
      return conn.ws;
    }

    // Pool 為空，fallback：建立新連線（有延遲）
    console.warn('[WarmPool] Pool empty — creating connection on-demand (cold start)');
    return this.createReadyWs(language);
  }

  /**
   * 停止 WarmPool，關閉所有連線
   */
  stop(): void {
    this.isShuttingDown = true;
    if (this.refillTimer) clearInterval(this.refillTimer);
    for (const conn of this.pool) {
      conn.ws.close(1000, 'WarmPool shutdown');
    }
    this.pool = [];
    console.log('[WarmPool] Stopped');
  }

  get size(): number { return this.pool.length; }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  private async addConnection(): Promise<void> {
    if (this.isShuttingDown) return;
    try {
      const ws = await this.createReadyWs(this.defaultLanguage);
      this.pool.push({ ws, language: this.defaultLanguage, readyAt: Date.now() });
      console.log(`[WarmPool] Connection added (pool=${this.pool.length}/${this.poolSize})`);

      // 監聽斷線，自動補充
      ws.on('close', () => {
        if (this.isShuttingDown) return;
        this.pool = this.pool.filter(c => c.ws !== ws);
        console.log(`[WarmPool] Connection closed, refilling (pool=${this.pool.length})`);
        this.addConnection().catch(e => console.warn('[WarmPool] Refill failed:', e.message));
      });
    } catch (e) {
      console.warn('[WarmPool] Failed to add connection:', (e as Error).message);
    }
  }

  private createReadyWs(language: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_WS_URL, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WarmPool connection timeout'));
      }, 15000);

      ws.on('open', () => {
        ws.send(makeSessionUpdatePayload(language));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'session.updated') {
            clearTimeout(timeout);
            resolve(ws);
          } else if (event.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error((event.error as { message?: string })?.message || 'API error'));
          }
        } catch {}
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private waitForSessionUpdated(ws: WebSocket, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      const handler = (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'session.updated') {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve();
          }
        } catch {}
      };
      ws.on('message', handler);
    });
  }

  private evictExpired(): void {
    const now = Date.now();
    const before = this.pool.length;
    this.pool = this.pool.filter(c => {
      if (now - c.readyAt > this.maxIdleMs) {
        c.ws.close(1000, 'Idle timeout');
        return false;
      }
      return true;
    });
    if (this.pool.length < before) {
      console.log(`[WarmPool] Evicted ${before - this.pool.length} expired connections`);
    }
  }

  private scheduleRefill(): void {
    // 每 30 秒檢查並補充 pool
    this.refillTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      this.evictExpired();
      const deficit = this.poolSize - this.pool.length;
      if (deficit > 0) {
        console.log(`[WarmPool] Refilling ${deficit} connections`);
        for (let i = 0; i < deficit; i++) {
          this.addConnection().catch(e => console.warn('[WarmPool] Scheduled refill failed:', e.message));
        }
      }
    }, 30_000);
  }
}

// ─── WebSocket 代理 Session ───────────────────────────────────────────────────

export interface RealtimeWhisperSessionOptions {
  apiKey: string;
  language?: string;
  warmPool?: WarmPool;  // 若提供，優先從 pool 取出連線
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
  private connectedAt: number | null = null;

  constructor(sessionId: string, opts: RealtimeWhisperSessionOptions) {
    super();
    this.sessionId = sessionId;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    if (this.isDestroyed) return;

    const language = this.opts.language || 'zh';
    const t0 = Date.now();

    // 嘗試從 WarmPool 取出預建連線
    if (this.opts.warmPool) {
      try {
        const ws = await this.opts.warmPool.acquire(language);
        this.ws = ws;
        this.isReady = true;
        this.connectedAt = Date.now();
        const elapsed = Date.now() - t0;
        console.log(`[RTW:${this.sessionId}] Warm connection acquired in ${elapsed}ms`);
        this.attachHandlers(ws);
        this.opts.onConnected(this.sessionId);
        return;
      } catch (e) {
        console.warn(`[RTW:${this.sessionId}] WarmPool acquire failed, falling back to cold connect:`, (e as Error).message);
      }
    }

    // Fallback：冷啟動建立新連線
    return this.coldConnect(language, t0);
  }

  private coldConnect(language: string, t0: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_WS_URL, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 15000);

      ws.on('open', () => {
        console.log(`[RTW:${this.sessionId}] Cold WS connected (${Date.now() - t0}ms)`);
        ws.send(makeSessionUpdatePayload(language));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'session.updated') {
            this.isReady = true;
            this.connectedAt = Date.now();
            clearTimeout(timeout);
            console.log(`[RTW:${this.sessionId}] Cold connect ready (${Date.now() - t0}ms)`);
            this.attachHandlers(ws);
            this.opts.onConnected(this.sessionId);
            resolve();
          } else if (event.type === 'error') {
            const errMsg = (event.error as { message?: string })?.message || 'Unknown error';
            clearTimeout(timeout);
            reject(new Error(errMsg));
          }
        } catch {}
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * 將事件處理器附加到已就緒的 WebSocket
   */
  private attachHandlers(ws: WebSocket): void {
    // 移除 coldConnect 的 message handler（避免重複）
    ws.removeAllListeners('message');
    ws.removeAllListeners('error');
    ws.removeAllListeners('close');

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch (e) {
        console.error(`[RTW:${this.sessionId}] Parse error:`, e);
      }
    });

    ws.on('error', (err) => {
      console.error(`[RTW:${this.sessionId}] WS error:`, err.message);
      this.opts.onError(err.message, this.sessionId);
    });

    ws.on('close', (code, reason) => {
      console.log(`[RTW:${this.sessionId}] WS closed: ${code} ${reason}`);
      this.isReady = false;
      this.opts.onDisconnected(this.sessionId);
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    });
  }

  private handleEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'session.created':
        console.log(`[RTW:${this.sessionId}] session.created`);
        break;

      case 'session.updated':
        // 語言切換後的 session.updated（已就緒狀態下）
        console.log(`[RTW:${this.sessionId}] session.updated (language change)`);
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
        break;
      }
    }
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    }));
  }

  commit(): void {
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  async updateLanguage(language: string): Promise<void> {
    this.opts = { ...this.opts, language };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(makeSessionUpdatePayload(language));
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
  get connectedDuration(): number | null {
    return this.connectedAt ? Date.now() - this.connectedAt : null;
  }
}

// ─── Session 管理器 ────────────────────────────────────────────────────────────

/**
 * 管理所有 Socket.IO 連線的 RealtimeWhisperSession
 */
export class RealtimeWhisperManager {
  private sessions = new Map<string, RealtimeWhisperSession>();
  private apiKey: string;
  private warmPool: WarmPool;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.warmPool = new WarmPool({
      apiKey,
      defaultLanguage: 'zh',
      poolSize: 2,
      maxIdleMs: 120_000,
    });
  }

  /**
   * 啟動 WarmPool（伺服器啟動時呼叫）
   */
  async startWarmPool(): Promise<void> {
    await this.warmPool.start();
  }

  async createSession(
    socketId: string,
    language: string,
    callbacks: Omit<RealtimeWhisperSessionOptions, 'apiKey' | 'language' | 'warmPool'>,
  ): Promise<RealtimeWhisperSession> {
    this.destroySession(socketId);

    const session = new RealtimeWhisperSession(socketId, {
      apiKey: this.apiKey,
      language,
      warmPool: this.warmPool,
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
    this.warmPool.stop();
  }

  get size(): number { return this.sessions.size; }
  get poolSize(): number { return this.warmPool.size; }
}

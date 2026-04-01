/**
 * 共用介面定義 - OpenAI 和 Gemini 即時翻譯客戶端
 */

export type RealtimeProvider = 'openai' | 'gemini';

/**
 * 即時翻譯客戶端選項
 */
export interface IRealtimeClientOptions {
    apiKey: string;
    model?: string;
    sourceLang?: string;
    targetLang?: string;
    autoReconnect?: boolean;
    domain?: string;
}

/**
 * 翻譯結果
 */
export interface TranslationResult {
    type: 'translate';
    sourceLang: string;
    targetLang: string;
    textSource: string;
    textTarget: string;
    confidence?: 'high' | 'medium' | 'low';
}

/**
 * 重連資訊
 */
export interface ReconnectInfo {
    attempt: number;
    maxAttempts: number;
    delay: number;
}

/**
 * 斷線資訊
 */
export interface DisconnectInfo {
    code: number;
    reason: string;
}

/**
 * 即時翻譯客戶端介面
 */
export interface IRealtimeClient {
    /** 連線狀態 */
    isConnected: boolean;

    /** 提供者名稱 */
    readonly provider: RealtimeProvider;

    /** 連接到 API */
    connect(): Promise<void>;

    /** 斷開連接 */
    disconnect(): void;

    /** 取得當前使用的模型 */
    getModel(): string;

    /** 取得 Session 資訊（供前端/報告使用） */
    getSessionInfo(): { sessionId: string; model: string; provider: string };

    /** 取得當前語言設定 */
    getLanguages(): { sourceLang: string; targetLang: string };

    /** 設定語言 */
    setLanguages(source: string, target: string): void;

    /** 發送音訊資料 */
    sendAudioChunk(buffer: ArrayBuffer | Buffer): void;

    /** 發送使用者文字訊息 */
    sendUserMessage(text: string): void;

    /** 發送工具呼叫的回應（如 glossary lookup 結果）*/
    sendToolResponse?(functionCallId: string, result: object): void;

    /** 設定自動重連 */
    setAutoReconnect(enabled: boolean): void;

    // 事件監聽器
    on(event: 'connected', listener: () => void): this;
    on(event: 'disconnected', listener: (info: DisconnectInfo) => void): this;
    on(event: 'error', listener: (error: unknown) => void): this;
    on(event: 'text', listener: (text: string) => void): this;
    on(event: 'text_delta', listener: (delta: string) => void): this;
    on(event: 'transcript', listener: (transcript: string) => void): this;
    on(event: 'transcript_delta', listener: (delta: string, accumulated: string) => void): this;
    on(event: 'speech_started', listener: () => void): this;
    on(event: 'speech_stopped', listener: () => void): this;
    on(event: 'audio_delta', listener: (delta: string) => void): this;
    on(event: 'audio_done', listener: () => void): this;
    on(event: 'reconnecting', listener: (info: ReconnectInfo) => void): this;
    on(event: 'reconnected', listener: () => void): this;
    on(event: 'reconnect_failed', listener: (info: { attempts: number }) => void): this;
    on(event: 'tool_call', listener: (call: { id: string; name: string; args: Record<string, unknown> }) => void): this;

    // 便捷方法
    onText(callback: (text: string) => void): void;
    onTextDelta(callback: (delta: string) => void): void;
    onTranscript(callback: (transcript: string) => void): void;
    onTranscriptDelta(callback: (delta: string, accumulated: string) => void): void;
    onSpeechStarted(callback: () => void): void;
    onSpeechStopped(callback: () => void): void;
    onAudioDelta(callback: (delta: string) => void): void;
    onReconnecting(callback: (info: ReconnectInfo) => void): void;
    onReconnected(callback: () => void): void;
    onReconnectFailed(callback: (info: { attempts: number }) => void): void;
}

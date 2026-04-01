import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { RealtimeProvider } from './types';

const REALTIME_API_URL = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

export interface RealtimeClientOptions {
    apiKey: string;
    model?: string;
    sourceLang?: string;
    targetLang?: string;
    autoReconnect?: boolean;
}

export interface TranslationResult {
    type: 'translate';
    sourceLang: string;
    targetLang: string;
    textSource: string;
    textTarget: string;
}

export class OpenAIRealtimeClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private model: string;
    public isConnected = false;
    public readonly provider: RealtimeProvider = 'openai';
    private textBuffer = '';
    private transcriptBuffer = ''; // 新增：累積 transcript delta

    // Session 資訊
    private sessionId: string = '';

    // 語言設定
    private sourceLang: string = 'zh-TW';
    private targetLang: string = 'en';

    // 領域設定
    private domain: string = '';

    // Server VAD 設定 - 調低閾值讓較短停頓也能觸發分段
    private vadThreshold: number = 0.3;          // 降低：0.5 -> 0.3（更敏感）
    private vadSilenceDurationMs: number = 300;  // 降低：600 -> 300（300ms 停頓就分段）

    // 自動重連設定
    private autoReconnect: boolean = true;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 1000; // 初始延遲 1 秒
    private isReconnecting: boolean = false;
    private manualDisconnect: boolean = false;

    // 心跳檢測設定
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private pingIntervalMs: number = 30000; // 每 30 秒發送一次 ping
    private pongTimeoutMs: number = 10000;  // 10 秒內沒收到 pong 視為斷線

    constructor(options: RealtimeClientOptions) {
        super();
        this.apiKey = options.apiKey;
        this.model = options.model || DEFAULT_MODEL;
        if (options.sourceLang) this.sourceLang = options.sourceLang;
        if (options.targetLang) this.targetLang = options.targetLang;
        if (options.autoReconnect !== undefined) this.autoReconnect = options.autoReconnect;
        if ((options as any).domain) this.domain = (options as any).domain;

        // 初始化 session ID
        this.sessionId = `openai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🆔 [OpenAI] Session ID: ${this.sessionId}`);
        console.log(`📦 [OpenAI] Model: ${this.model}`);
    }

    /**
     * 取得當前使用的模型
     */
    getModel(): string {
        return this.model;
    }

    /**
     * 取得 Session 資訊（供前端/報告使用）
     */
    getSessionInfo(): { sessionId: string; model: string; provider: string } {
        return {
            sessionId: this.sessionId,
            model: this.model,
            provider: this.provider,
        };
    }

    // 取得當前語言設定
    getLanguages(): { sourceLang: string; targetLang: string } {
        return {
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
        };
    }

    // 設定語言
    setLanguages(source: string, target: string): void {
        this.sourceLang = source;
        this.targetLang = target;
        console.log(`🌐 Language changed: ${source} → ${target}`);
        if (this.isConnected) {
            this.sendEvent({
                type: 'session.update',
                session: {
                    instructions: this.buildInstructions(),
                    input_audio_transcription: {
                        model: 'gpt-4o-mini-transcribe',
                        language: this.getWhisperLanguageCode(source), // 更新語音辨識語言
                    },
                },
            });
        }
    }

    // 設定 VAD 參數（可選）
    setVadConfig(threshold: number, silenceDurationMs: number): void {
        this.vadThreshold = threshold;
        this.vadSilenceDurationMs = silenceDurationMs;
        if (this.isConnected) {
            this.sendEvent({
                type: 'session.update',
                session: {
                    turn_detection: {
                        type: 'server_vad',
                        threshold: this.vadThreshold,
                        silence_duration_ms: this.vadSilenceDurationMs,
                    },
                },
            });
        }
    }

    /**
     * 啟用/停用自動重連
     */
    setAutoReconnect(enabled: boolean): void {
        this.autoReconnect = enabled;
        console.log(`🔄 Auto-reconnect ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * 設定心跳檢測間隔
     */
    setHeartbeatConfig(pingIntervalMs: number, pongTimeoutMs: number): void {
        this.pingIntervalMs = pingIntervalMs;
        this.pongTimeoutMs = pongTimeoutMs;
        console.log(`💓 Heartbeat config: ping every ${pingIntervalMs}ms, timeout ${pongTimeoutMs}ms`);
    }

    /**
     * 啟動心跳檢測
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.pingInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            console.log('💓 Sending ping...');
            this.ws.ping();

            this.pongTimeout = setTimeout(() => {
                console.warn('⚠️ Pong timeout - connection may be dead');
                this.handleConnectionDead();
            }, this.pongTimeoutMs);

        }, this.pingIntervalMs);

        console.log('💓 Heartbeat started');
    }

    /**
     * 停止心跳檢測
     */
    private stopHeartbeat(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    /**
     * 處理連線假死
     */
    private handleConnectionDead(): void {
        console.warn('💀 Connection appears dead, terminating...');
        this.stopHeartbeat();

        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }

        this.isConnected = false;
        this.emit('connection_dead');

        if (this.autoReconnect && !this.manualDisconnect) {
            this.attemptReconnect();
        }
    }

    /**
     * 嘗試重新連線
     */
    private async attemptReconnect(): Promise<void> {
        if (this.isReconnecting) {
            console.log('🔄 Already reconnecting, skip...');
            return;
        }

        if (!this.autoReconnect || this.manualDisconnect) {
            console.log('🔄 Auto-reconnect disabled or manual disconnect');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            this.emit('reconnect_failed', { attempts: this.reconnectAttempts });
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

        this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delay
        });

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.connect();
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            console.log('✅ Reconnected successfully');
            this.emit('reconnected');
        } catch (error) {
            console.error('❌ Reconnect failed:', error);
            this.isReconnecting = false;
            this.attemptReconnect();
        }
    }

    // 將應用語言代碼轉換為 Whisper 語言代碼
    // Whisper 使用 ISO 639-1 語言代碼
    private getWhisperLanguageCode(lang: string): string {
        const langMap: Record<string, string> = {
            'zh-TW': 'zh',      // 繁體中文
            'zh-CN': 'zh',      // 簡體中文
            'en': 'en',         // 英文
            'vi': 'vi',         // 越南文
            'ja': 'ja',         // 日文
            'ko': 'ko',         // 韓文
            'th': 'th',         // 泰文
            'id': 'id',         // 印尼文
        };
        return langMap[lang] || lang.split('-')[0];
    }

    // 建立翻譯專用的 system prompt
    private buildInstructions(): string {
        const domainHint = this.domain
            ? `你正在${this.domain}領域的場景中工作。請使用該領域的專業術語。`
            : '';
        return `
你是一個即時口語翻譯助手。
- 說話者語言：${this.sourceLang}
- 目標語言：${this.targetLang}
${domainHint}
先把輸入語音正確辨識成文字，再翻譯成目標語言。
理解說話者的意圖，將口語化表達改寫為專業、完整的句子。
回應要短、自然，適合即時顯示。`.trim();
    }

    /**
     * 連接到 OpenAI Realtime API
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 如果已經連接，先斷開
            if (this.ws) {
                this.ws.terminate();
                this.ws = null;
            }

            this.manualDisconnect = false;
            const url = `${REALTIME_API_URL}?model=${this.model}`;

            console.log(`🔌 Connecting to OpenAI Realtime API...`);
            console.log(`   Model: ${this.model}`);

            this.ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1',
                },
            });

            this.ws.on('open', () => {
                console.log('✅ Connected to OpenAI Realtime API');
                this.isConnected = true;

                // 啟動心跳檢測
                this.startHeartbeat();

                // 初始化 session 設定 - 使用 server VAD
                this.sendEvent({
                    type: 'session.update',
                    session: {
                        modalities: ['text', 'audio'], // 支援文字和音訊
                        instructions: this.buildInstructions(),
                        input_audio_format: 'pcm16',
                        output_audio_format: 'pcm16',
                        input_audio_transcription: {
                            model: 'gpt-4o-mini-transcribe', // 使用 GPT-4o-mini 轉錄模型（更高準確度）
                            language: this.getWhisperLanguageCode(this.sourceLang), // 指定語言提高辨識準確度
                        },
                        turn_detection: {
                            type: 'server_vad',
                            threshold: this.vadThreshold,
                            silence_duration_ms: this.vadSilenceDurationMs,
                            create_response: true,        // 自動創建回應
                            interrupt_response: true,     // 允許中斷
                        },
                    },
                });

                this.emit('connected');
                resolve();
            });

            // 處理 pong 回應
            this.ws.on('pong', () => {
                console.log('💓 Pong received');
                if (this.pongTimeout) {
                    clearTimeout(this.pongTimeout);
                    this.pongTimeout = null;
                }
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.handleEvent(event);
                } catch (error) {
                    console.error('🚨 Failed to parse message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('🚨 WebSocket error:', error);
                this.emit('error', error);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`❌ Disconnected from OpenAI Realtime API: ${code} - ${reason}`);
                this.isConnected = false;
                this.stopHeartbeat();
                this.emit('disconnected', { code, reason: reason.toString() });

                // 非手動斷開時嘗試重連
                if (!this.manualDisconnect && this.autoReconnect) {
                    this.attemptReconnect();
                }
            });
        });
    }

    /**
     * 發送使用者文字訊息
     */
    sendUserMessage(text: string): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 Not connected to Realtime API');
            return;
        }

        console.log(`📤 Sending user message: ${text}`);

        // 建立 conversation item
        this.sendEvent({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: text,
                    },
                ],
            },
        });

        // 請求 AI 回應
        this.sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text'],
            },
        });
    }

    /**
     * 註冊文字回調
     */
    onText(callback: (text: string) => void): void {
        this.on('text', callback);
    }

    /**
     * 註冊文字串流回調（delta）
     */
    onTextDelta(callback: (delta: string) => void): void {
        this.on('text_delta', callback);
    }

    /**
     * 註冊語音轉錄回調
     */
    onTranscript(callback: (transcript: string) => void): void {
        this.on('transcript', callback);
    }

    /**
     * 註冊語音轉錄 Delta 回調（逐字）
     */
    onTranscriptDelta(callback: (delta: string, accumulated: string) => void): void {
        this.on('transcript_delta', callback);
    }

    /**
     * 註冊重連事件回調
     */
    onReconnecting(callback: (info: { attempt: number; maxAttempts: number; delay: number }) => void): void {
        this.on('reconnecting', callback);
    }

    /**
     * 註冊重連成功回調
     */
    onReconnected(callback: () => void): void {
        this.on('reconnected', callback);
    }

    /**
     * 註冊重連失敗回調
     */
    onReconnectFailed(callback: (info: { attempts: number }) => void): void {
        this.on('reconnect_failed', callback);
    }

    /**
     * 發送音訊資料（PCM16 格式）
     * @param buffer PCM16 格式的音訊資料
     */
    sendAudioChunk(buffer: ArrayBuffer | Buffer): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 Not connected to Realtime API');
            return;
        }

        // 將 ArrayBuffer 或 Buffer 轉換為 base64
        let base64Audio: string;
        if (buffer instanceof Buffer) {
            base64Audio = buffer.toString('base64');
        } else {
            base64Audio = Buffer.from(new Uint8Array(buffer)).toString('base64');
        }
        console.log(`🎤 Sending audio chunk: ${buffer.byteLength} bytes`);

        // 發送音訊資料
        this.sendEvent({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
        });
    }

    /**
     * 提交音訊緩衝區並請求回應
     * （server VAD 模式下通常不需要呼叫此方法）
     */
    commitAudioAndRespond(): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 Not connected to Realtime API');
            return;
        }

        console.log('🎤 Committing audio buffer and requesting response');

        // 提交音訊緩衝區
        this.sendEvent({
            type: 'input_audio_buffer.commit',
        });

        // 請求 AI 回應（文字模式）
        this.sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text'],
            },
        });
    }

    /**
     * 監聽語音開始
     */
    onSpeechStarted(callback: () => void): void {
        this.on('speech_started', callback);
    }

    /**
     * 監聽語音結束
     */
    onSpeechStopped(callback: () => void): void {
        this.on('speech_stopped', callback);
    }

    /**
     * 監聯音訊 delta
     */
    onAudioDelta(callback: (delta: string) => void): void {
        this.on('audio_delta', callback);
    }

    /**
     * 斷開連接
     */
    disconnect(): void {
        this.manualDisconnect = true; // 標記為手動斷開，不觸發重連
        this.stopHeartbeat();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }

        // 重置重連計數
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
    }

    /**
     * 發送事件到 WebSocket
     */
    private sendEvent(event: object): void {
        if (this.ws && this.isConnected) {
            const data = JSON.stringify(event);
            this.ws.send(data);
            console.log(`📤 Sent event: ${(event as { type: string }).type}`);
        }
    }

    /**
     * 處理從 OpenAI 收到的事件
     */
    private handleEvent(event: { type: string;[key: string]: unknown }): void {
        // Debug: 記錄所有非音訊的事件
        if (!event.type.includes('audio.delta') && !event.type.includes('rate_limits')) {
            console.log(`📡 Event received: ${event.type}`);
        }

        switch (event.type) {
            case 'session.created':
                console.log('📋 Session created');
                this.emit('session_created', event);
                break;

            case 'session.updated':
                console.log('📋 Session updated');
                break;

            case 'response.text.delta':
                // 文字串流片段
                const delta = (event as { delta?: string }).delta || '';
                this.textBuffer += delta;
                this.emit('text_delta', delta);
                break;

            case 'response.text.done':
                // 單個文字輸出完成
                const text = (event as { text?: string }).text || this.textBuffer;
                console.log(`📥 Text complete: ${text}`);
                break;

            case 'response.output_item.done':
                // 輸出項目完成
                const item = (event as { item?: { content?: Array<{ text?: string }> } }).item;
                if (item?.content) {
                    for (const content of item.content) {
                        if (content.text) {
                            console.log(`📥 Output item text: ${content.text}`);
                        }
                    }
                }
                break;

            case 'response.done':
                // 整個回應完成
                console.log('📥 Response complete');
                const response = event as {
                    response?: {
                        output?: Array<{
                            type?: string;
                            content?: Array<{ type?: string; text?: string; transcript?: string }>;
                        }>;
                    };
                };

                // 從 response.output 提取完整文字（支援 text 和 audio transcript）
                const outputs = response.response?.output || [];
                for (const output of outputs) {
                    if (output.content) {
                        for (const content of output.content) {
                            if (content.type === 'text' && content.text) {
                                this.emit('text', content.text);
                            }
                            if (content.type === 'audio' && content.transcript) {
                                this.emit('text', content.transcript);
                            }
                        }
                    }
                }

                // 清空 buffer
                this.textBuffer = '';
                this.emit('response_done', response.response);
                break;

            case 'conversation.item.input_audio_transcription.delta':
                // 語音轉錄 delta（逐字串流）
                const transcriptDeltaText = (event as { delta?: string }).delta || '';
                if (transcriptDeltaText) {
                    this.transcriptBuffer += transcriptDeltaText;
                    console.log(`📥 Transcript delta: "${transcriptDeltaText}" (accumulated: "${this.transcriptBuffer}")`);
                    this.emit('transcript_delta', transcriptDeltaText, this.transcriptBuffer);
                }
                break;

            case 'conversation.item.input_audio_transcription.completed':
                // 語音轉錄完成
                const transcriptEvent = event as { transcript?: string };
                const transcript = transcriptEvent.transcript || this.transcriptBuffer;
                console.log(`📥 Transcript completed: ${transcript}`);
                this.emit('transcript', transcript);
                // 清空 transcript buffer
                this.transcriptBuffer = '';
                break;

            case 'input_audio_buffer.committed':
                console.log('📥 Audio buffer committed');
                break;

            case 'input_audio_buffer.speech_started':
                console.log('📥 Speech started detected');
                // 清空 transcript buffer 準備新的語音
                this.transcriptBuffer = '';
                this.emit('speech_started');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('📥 Speech stopped detected');
                this.emit('speech_stopped');
                break;

            case 'response.audio.delta':
                // 音訊串流片段
                const audioDelta = (event as { delta?: string }).delta || '';
                this.emit('audio_delta', audioDelta);
                break;

            case 'response.audio.done':
                console.log('📥 Audio response complete');
                this.emit('audio_done');
                break;

            case 'response.audio_transcript.delta':
                // 音訊轉錄串流片段
                const transcriptDelta = (event as { delta?: string }).delta || '';
                this.emit('audio_transcript_delta', transcriptDelta);
                break;

            case 'response.audio_transcript.done':
                const audioTranscript = (event as { transcript?: string }).transcript || '';
                console.log(`📥 Audio transcript done: ${audioTranscript}`);
                this.emit('audio_transcript_done', audioTranscript);
                break;

            case 'error':
                const error = (event as { error?: { message?: string } }).error;
                console.error('🚨 Realtime API error:', error);
                this.emit('error', error);
                break;

            case 'rate_limits.updated':
                // 速率限制更新，忽略
                break;

            default:
                // 其他事件可以選擇性記錄
                // console.log(`📥 Unhandled event: ${event.type}`);
                break;
        }
    }
}

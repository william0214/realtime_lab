import WebSocket from 'ws';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { IRealtimeClient, IRealtimeClientOptions, RealtimeProvider, ReconnectInfo, DisconnectInfo } from './types';

const GEMINI_LIVE_API_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
// 預設使用 gemini-3-flash-preview，若不支援會 fallback 到 gemini-2.0-flash-exp
const DEFAULT_MODEL = 'models/gemini-3-flash-preview';
const FALLBACK_MODEL = 'models/gemini-2.0-flash-exp';

export interface GeminiRealtimeClientOptions extends IRealtimeClientOptions {
    voice?: string; // Gemini 支援多種語音：Puck, Charon, Kore, Fenrir, Aoede
}

export class GeminiRealtimeClient extends EventEmitter implements IRealtimeClient {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private model: string;
    private requestedModel: string; // 用戶請求的模型
    public isConnected = false;
    public readonly provider: RealtimeProvider = 'gemini';

    // Session 日誌
    private sessionId: string = '';
    private sessionLogPath: string = '';
    private sessionEvents: Array<{ timestamp: string; type: string; data: unknown }> = [];

    private transcriptBuffer = '';
    private textBuffer = '';

    // 語言設定
    private sourceLang: string = 'zh-TW';
    private targetLang: string = 'en';

    // 語音設定
    private voice: string = 'Kore';

    // 領域設定
    private domain: string = '';

    // VAD 設定
    private vadEnabled: boolean = true;
    private startSensitivity: 'START_SENSITIVITY_HIGH' | 'START_SENSITIVITY_LOW' = 'START_SENSITIVITY_HIGH';
    private endSensitivity: 'END_SENSITIVITY_HIGH' | 'END_SENSITIVITY_LOW' = 'END_SENSITIVITY_HIGH';
    private silenceDurationMs: number = 500;

    // 自動重連設定
    private autoReconnect: boolean = true;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 1000;
    private isReconnecting: boolean = false;
    private manualDisconnect: boolean = false;

    // 心跳檢測設定
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private pingIntervalMs: number = 30000;
    private pongTimeoutMs: number = 10000;

    constructor(options: GeminiRealtimeClientOptions) {
        super();
        this.apiKey = options.apiKey;
        this.requestedModel = options.model || process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
        // 確保 model 有 models/ 前綴
        this.model = this.requestedModel.startsWith('models/') 
            ? this.requestedModel 
            : `models/${this.requestedModel}`;
        if (options.sourceLang) this.sourceLang = options.sourceLang;
        if (options.targetLang) this.targetLang = options.targetLang;
        if (options.autoReconnect !== undefined) this.autoReconnect = options.autoReconnect;
        if (options.voice) this.voice = options.voice;
        if (options.domain) this.domain = options.domain;
        
        // 初始化 session ID
        this.sessionId = `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🆔 [Gemini] Session ID: ${this.sessionId}`);
        console.log(`📦 [Gemini] Requested model: ${this.model}`);
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

    /**
     * 記錄 session 事件到日誌
     */
    private logSessionEvent(type: string, data: unknown): void {
        const event = {
            timestamp: new Date().toISOString(),
            type,
            data,
        };
        this.sessionEvents.push(event);

        // 同步寫入檔案（確保不遺失）
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            this.sessionLogPath = path.join(logsDir, `session_${this.sessionId}.jsonl`);
            fs.appendFileSync(this.sessionLogPath, JSON.stringify(event) + '\n');
        } catch (err) {
            // 靜默失敗，避免影響主流程
        }
    }

    getLanguages(): { sourceLang: string; targetLang: string } {
        return {
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
        };
    }

    setLanguages(source: string, target: string): void {
        this.sourceLang = source;
        this.targetLang = target;
        console.log(`🌐 [Gemini] Language changed: ${source} → ${target}`);
        // Gemini 需要重新建立 session 來更新語言設定
        if (this.isConnected) {
            console.log('⚠️ [Gemini] Language change requires reconnection');
            // 可選：自動重連以套用新設定
        }
    }

    setVadConfig(enabled: boolean, silenceDurationMs?: number): void {
        this.vadEnabled = enabled;
        if (silenceDurationMs !== undefined) {
            this.silenceDurationMs = silenceDurationMs;
        }
        console.log(`🎙️ [Gemini] VAD config: enabled=${enabled}, silenceDuration=${this.silenceDurationMs}ms`);
    }

    setAutoReconnect(enabled: boolean): void {
        this.autoReconnect = enabled;
        console.log(`🔄 [Gemini] Auto-reconnect ${enabled ? 'enabled' : 'disabled'}`);
    }

    setHeartbeatConfig(pingIntervalMs: number, pongTimeoutMs: number): void {
        this.pingIntervalMs = pingIntervalMs;
        this.pongTimeoutMs = pongTimeoutMs;
        console.log(`💓 [Gemini] Heartbeat config: ping every ${pingIntervalMs}ms, timeout ${pongTimeoutMs}ms`);
    }

    private buildInstructions(): string {
        const domainHint = this.domain
            ? `你正在${this.domain}領域的場景中工作。請使用該領域的專業術語。`
            : '';
        const ragHint = this.domain && this.domain !== 'general'
            ? `\n當你在語音中偵測到可能的專業術語時，請呼叫 lookup_glossary 工具查詢正確的翻譯用語，再進行翻譯。`
            : '';
        return `
你是一個即時口語翻譯助手。
- 說話者語言：${this.sourceLang}
- 目標語言：${this.targetLang}
${domainHint}${ragHint}
請將使用者的語音翻譯成目標語言。
理解說話者的意圖，將口語化表達改寫為專業、完整的句子。
回應要短、自然，適合即時顯示。
只輸出翻譯結果，不要加入額外的解釋或說明。`.trim();
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.pingInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            console.log('💓 [Gemini] Sending ping...');
            this.ws.ping();

            this.pongTimeout = setTimeout(() => {
                console.warn('⚠️ [Gemini] Pong timeout - connection may be dead');
                this.handleConnectionDead();
            }, this.pongTimeoutMs);

        }, this.pingIntervalMs);

        console.log('💓 [Gemini] Heartbeat started');
    }

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

    private handleConnectionDead(): void {
        console.warn('💀 [Gemini] Connection appears dead, terminating...');
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

    private async attemptReconnect(): Promise<void> {
        if (this.isReconnecting) {
            console.log('🔄 [Gemini] Already reconnecting, skip...');
            return;
        }

        if (!this.autoReconnect || this.manualDisconnect) {
            console.log('🔄 [Gemini] Auto-reconnect disabled or manual disconnect');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ [Gemini] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            this.emit('reconnect_failed', { attempts: this.reconnectAttempts });
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`🔄 [Gemini] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

        const reconnectInfo: ReconnectInfo = {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delay
        };
        this.emit('reconnecting', reconnectInfo);

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.connect();
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            console.log('✅ [Gemini] Reconnected successfully');
            this.emit('reconnected');
        } catch (error) {
            console.error('❌ [Gemini] Reconnect failed:', error);
            this.isReconnecting = false;
            this.attemptReconnect();
        }
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws) {
                this.ws.terminate();
                this.ws = null;
            }

            // 重新生成 session ID
            this.sessionId = `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.sessionEvents = [];

            this.manualDisconnect = false;
            const url = `${GEMINI_LIVE_API_URL}?key=${this.apiKey}`;

            console.log(`🔌 [Gemini] Connecting to Gemini Live API...`);
            console.log(`   Session ID: ${this.sessionId}`);
            console.log(`   Model: ${this.model}`);

            this.logSessionEvent('connect_start', { model: this.model, sessionId: this.sessionId });

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                console.log('✅ [Gemini] WebSocket connected, sending setup...');
                this.logSessionEvent('ws_open', {});
                this.sendSetup();
            });

            this.ws.on('pong', () => {
                console.log('💓 [Gemini] Pong received');
                if (this.pongTimeout) {
                    clearTimeout(this.pongTimeout);
                    this.pongTimeout = null;
                }
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message, resolve, reject);
                } catch (error) {
                    console.error('🚨 [Gemini] Failed to parse message:', error);
                    this.logSessionEvent('parse_error', { error: String(error) });
                }
            });

            this.ws.on('error', (error) => {
                console.error('🚨 [Gemini] WebSocket error:', error);
                this.logSessionEvent('ws_error', { error: String(error) });
                this.emit('error', error);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                const reasonStr = reason.toString();
                console.log(`❌ [Gemini] Disconnected: ${code} - ${reasonStr}`);
                
                // 標記 1005/1006 為異常關閉
                const isAbnormal = code === 1005 || code === 1006;
                if (isAbnormal) {
                    console.warn(`⚠️ [Gemini] ABNORMAL CLOSE (code=${code}) - 可能是網路問題或長時間無音訊`);
                }
                
                this.logSessionEvent('ws_close', { code, reason: reasonStr, isAbnormal });
                this.isConnected = false;
                this.stopHeartbeat();

                const disconnectInfo: DisconnectInfo = { code, reason: reasonStr };
                this.emit('disconnected', disconnectInfo);

                if (!this.manualDisconnect && this.autoReconnect) {
                    this.attemptReconnect();
                }
            });
        });
    }

    private buildToolDeclarations(): object[] | undefined {
        // 只在非 general 領域啟用 glossary 工具
        if (!this.domain || this.domain === 'general') return undefined;
        return [{
            functionDeclarations: [{
                name: 'lookup_glossary',
                description: '查詢該領域的專業術語翻譯和定義。當語音中出現可能的專業術語時呼叫此工具，以確保翻譯使用正確的專業用語。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: '要查詢的術語或短語',
                        }
                    },
                    required: ['query'],
                },
            }]
        }];
    }

    /**
     * 發送 tool call 的回應給 Gemini
     */
    sendToolResponse(functionCallId: string, result: object): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 [Gemini] Not connected, cannot send tool response');
            return;
        }

        const message = {
            toolResponse: {
                functionResponses: [{
                    id: functionCallId,
                    name: 'lookup_glossary',
                    response: result,
                }]
            }
        };

        console.log(`📤 [Gemini] Sending tool response for ${functionCallId}`);
        this.logSessionEvent('tool_response_sent', { functionCallId, result });
        this.ws.send(JSON.stringify(message));
    }

    private sendSetup(): void {
        const tools = this.buildToolDeclarations();
        const setup = {
            setup: {
                model: this.model,
                generationConfig: {
                    responseModalities: ['TEXT'], // 只要文字翻譯，不需要音訊輸出
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: this.voice
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: this.buildInstructions() }]
                },
                ...(tools ? { tools } : {}),
                realtimeInputConfig: {
                    automaticActivityDetection: {
                        disabled: !this.vadEnabled,
                        startOfSpeechSensitivity: this.startSensitivity,
                        endOfSpeechSensitivity: this.endSensitivity,
                        prefixPaddingMs: 20,
                        silenceDurationMs: this.silenceDurationMs
                    }
                },
                inputAudioTranscription: {}, // 啟用輸入音訊轉錄
            }
        };

        console.log('📤 [Gemini] Sending setup:', JSON.stringify(setup, null, 2));
        this.logSessionEvent('setup_sent', { model: this.model });
        this.ws?.send(JSON.stringify(setup));
    }

    private handleMessage(
        message: Record<string, unknown>, 
        connectResolve?: (value: void) => void,
        connectReject?: (reason?: unknown) => void
    ): void {
        // 記錄所有 server 事件
        const eventType = Object.keys(message)[0] || 'unknown';
        this.logSessionEvent(`server_${eventType}`, message);

        // Setup 完成
        if (message.setupComplete) {
            console.log('✅ [Gemini] Setup complete');
            console.log(`📦 [Gemini] Active model: ${this.model}`);
            this.isConnected = true;
            this.startHeartbeat();
            this.emit('connected');
            connectResolve?.();
            return;
        }

        // 錯誤處理 - 檢查是否需要 fallback
        if (message.error) {
            const error = message.error as { code?: number; message?: string; status?: string };
            console.error('🚨 [Gemini] API error:', error);
            this.logSessionEvent('api_error', error);

            // 檢查是否為模型不支援錯誤
            const errorMsg = error.message || '';
            const isModelError = errorMsg.includes('not found') || 
                                 errorMsg.includes('not supported') ||
                                 errorMsg.includes('invalid model') ||
                                 error.code === 404;

            if (isModelError && this.model !== FALLBACK_MODEL) {
                console.warn(`⚠️ [Gemini] Model "${this.model}" not supported, falling back to "${FALLBACK_MODEL}"`);
                this.logSessionEvent('model_fallback', { from: this.model, to: FALLBACK_MODEL });
                this.model = FALLBACK_MODEL;
                
                // 重新發送 setup
                this.sendSetup();
                return;
            }

            this.emit('error', error);
            connectReject?.(error);
            return;
        }

        // 伺服器內容回應
        if (message.serverContent) {
            const content = message.serverContent as {
                inputTranscription?: { text: string };
                outputTranscription?: { text: string };
                modelTurn?: {
                    parts?: Array<{
                        text?: string;
                        inlineData?: { data: string; mimeType: string };
                    }>;
                };
                turnComplete?: boolean;
                interrupted?: boolean;
            };

            // 輸入音訊轉錄（原文）
            if (content.inputTranscription?.text) {
                const transcript = content.inputTranscription.text;
                console.log(`📥 [Gemini] Input transcription: ${transcript}`);
                this.logSessionEvent('transcription', { text: transcript });
                this.transcriptBuffer = transcript;
                this.emit('transcript', transcript);
            }

            // 模型回應（翻譯結果）
            if (content.modelTurn?.parts) {
                for (const part of content.modelTurn.parts) {
                    // 文字回應
                    if (part.text) {
                        console.log(`📥 [Gemini] Text response: ${part.text}`);
                        this.textBuffer += part.text;
                        this.emit('text_delta', part.text);
                    }
                    // 音訊回應
                    if (part.inlineData?.data) {
                        this.emit('audio_delta', part.inlineData.data);
                    }
                }
            }

            // 輸出轉錄
            if (content.outputTranscription?.text) {
                console.log(`📥 [Gemini] Output transcription: ${content.outputTranscription.text}`);
            }

            // 回合完成
            if (content.turnComplete) {
                console.log('📥 [Gemini] Turn complete');
                if (this.textBuffer) {
                    this.emit('text', this.textBuffer);
                    this.textBuffer = '';
                }
                this.emit('audio_done');
            }

            // 被中斷
            if (content.interrupted) {
                console.log('📥 [Gemini] Response interrupted');
                this.emit('interrupted');
            }
        }

        // 工具呼叫（glossary lookup 等）
        if (message.toolCall) {
            const toolCall = message.toolCall as {
                functionCalls?: Array<{
                    id: string;
                    name: string;
                    args: Record<string, unknown>;
                }>;
            };
            if (toolCall.functionCalls) {
                for (const fc of toolCall.functionCalls) {
                    console.log(`📥 [Gemini] Tool call: ${fc.name}(${JSON.stringify(fc.args)}) id=${fc.id}`);
                    this.logSessionEvent('tool_call', { id: fc.id, name: fc.name, args: fc.args });
                    this.emit('tool_call', { id: fc.id, name: fc.name, args: fc.args });
                }
            } else {
                console.log('📥 [Gemini] Tool call (unknown format):', message.toolCall);
                this.emit('tool_call', message.toolCall);
            }
        }

        // 錯誤處理
        if (message.error) {
            console.error('🚨 [Gemini] API error:', message.error);
            this.emit('error', message.error);
        }
    }

    sendAudioChunk(buffer: ArrayBuffer | Buffer): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 [Gemini] Not connected');
            return;
        }

        let base64Audio: string;
        if (buffer instanceof Buffer) {
            base64Audio = buffer.toString('base64');
        } else {
            base64Audio = Buffer.from(new Uint8Array(buffer)).toString('base64');
        }

        console.log(`🎤 [Gemini] Sending audio chunk: ${buffer.byteLength} bytes`);

        // Gemini 使用 16kHz PCM
        const message = {
            realtimeInput: {
                audio: {
                    data: base64Audio,
                    mimeType: 'audio/pcm;rate=16000'
                }
            }
        };

        this.ws.send(JSON.stringify(message));
    }

    sendUserMessage(text: string): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 [Gemini] Not connected');
            return;
        }

        console.log(`📤 [Gemini] Sending user message: ${text}`);

        const message = {
            clientContent: {
                turns: [
                    {
                        role: 'user',
                        parts: [{ text: text }]
                    }
                ],
                turnComplete: true
            }
        };

        this.ws.send(JSON.stringify(message));
    }

    /**
     * 發送即時文字輸入（不結束回合）
     */
    sendRealtimeText(text: string): void {
        if (!this.isConnected || !this.ws) {
            console.error('🚨 [Gemini] Not connected');
            return;
        }

        const message = {
            realtimeInput: {
                text: text
            }
        };

        this.ws.send(JSON.stringify(message));
    }

    disconnect(): void {
        this.manualDisconnect = true;
        this.stopHeartbeat();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }

        this.reconnectAttempts = 0;
        this.isReconnecting = false;
    }

    // 便捷事件監聽方法
    onText(callback: (text: string) => void): void {
        this.on('text', callback);
    }

    onTextDelta(callback: (delta: string) => void): void {
        this.on('text_delta', callback);
    }

    onTranscript(callback: (transcript: string) => void): void {
        this.on('transcript', callback);
    }

    onTranscriptDelta(callback: (delta: string, accumulated: string) => void): void {
        this.on('transcript_delta', callback);
    }

    onSpeechStarted(callback: () => void): void {
        this.on('speech_started', callback);
    }

    onSpeechStopped(callback: () => void): void {
        this.on('speech_stopped', callback);
    }

    onAudioDelta(callback: (delta: string) => void): void {
        this.on('audio_delta', callback);
    }

    onReconnecting(callback: (info: ReconnectInfo) => void): void {
        this.on('reconnecting', callback);
    }

    onReconnected(callback: () => void): void {
        this.on('reconnected', callback);
    }

    onReconnectFailed(callback: (info: { attempts: number }) => void): void {
        this.on('reconnect_failed', callback);
    }
}

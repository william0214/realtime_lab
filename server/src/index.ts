import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createRealtimeClient, IRealtimeClient, RealtimeProvider } from './realtime';
import { convertToPCM16, convertAccumulatedToPCM16, convertAccumulatedIncrementally, appendAudioChunk, resetAudioBuffer, checkFFmpeg, hasEnoughNewData, setTargetSampleRate } from './utils/audioConverter';
import { TranslationService, type LangCode } from './services/translationService';
import { getVADService, type VADConfig } from './services/vadService';
import { type DomainCode, getDomainConfig, getAllDomains, isValidDomain } from './services/domainService';
import { getVectorStore } from './services/vectorStore';
import { getMeetingService } from './services/meetingService';

// 載入環境變數
dotenv.config();

const app = express();
const httpServer = createServer(app);

// ============ 應用設定 ============
const CONFIG = {
    // 伺服器設定
    server: {
        port: process.env.PORT || 3001,
        corsOrigins: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
    },

    // 即時翻譯提供者設定
    realtime: {
        provider: (process.env.REALTIME_PROVIDER || 'openai') as RealtimeProvider,
        // OpenAI 設定
        openai: {
            apiKey: process.env.OPENAI_API_KEY || '',
            model: process.env.OPENAI_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
        },
        // Gemini 設定
        gemini: {
            apiKey: process.env.GOOGLE_API_KEY || '',
            // 優先使用 GEMINI_LIVE_MODEL（新），預設 gemini-3-flash-preview
            model: process.env.GEMINI_LIVE_MODEL || process.env.GEMINI_MODEL || 'models/gemini-3-flash-preview',
        },
    },

    // 支援的語言
    languages: {
        codes: ['zh-TW', 'en', 'ja', 'ko', 'vi', 'id', 'th'] as LangCode[],
        names: {
            'zh-TW': '繁體中文',
            'en': '英文',
            'ja': '日文',
            'ko': '韓文',
            'vi': '越南文',
            'id': '印尼文',
            'th': '泰文',
        } as Record<LangCode, string>,
        // 預設語言設定
        defaultSource: 'zh-TW' as LangCode,
        defaultTarget: 'en' as LangCode,
    },

    // 音訊處理設定
    audio: {
        conversionIntervalMs: 1500,  // 轉換間隔（毫秒）
        minBytesForConversion: 8000, // 最小累積資料量（位元組）
    },

    // VAD (語音活動偵測) 設定
    vad: {
        enabled: true,               // 是否啟用 VAD
        energyThreshold: 0.02,       // 能量閾值（0-1），降低以更敏感
        silenceFrameCount: 4,        // 連續靜音幀數才判定為靜音
        speechFrameCount: 1,         // 連續語音幀數才判定為語音（1 = 立即響應）
    } as VADConfig & { enabled: boolean },

    // 翻譯設定
    translation: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 500,
    },

    // 語言偵測設定
    languageDetection: {
        model: 'gpt-4o-mini',
        temperature: 0,
        maxTokens: 10,
    },
};

// 語言設定 (每個 socket 維護自己的設定)
interface SocketConfig {
    sourceLang: LangCode;
    targetLang: LangCode;
    domain: DomainCode;
    audioSource?: 'mic' | 'system'; // 目前音訊來源（用於雙流 speaker 標記）
}

// 儲存每個連線的設定
const socketConfigs = new Map<string, SocketConfig>();

// 每個 socket 的活躍會議 ID（全域可存取，供 transcription handler 使用）
const socketMeetings = new Map<string, string>();

// 初始化即時翻譯客戶端（支援 OpenAI 或 Gemini）
function initRealtimeClient(): IRealtimeClient {
    const provider = CONFIG.realtime.provider;
    const apiKey = provider === 'openai'
        ? CONFIG.realtime.openai.apiKey
        : CONFIG.realtime.gemini.apiKey;

    console.log(`🏭 Initializing ${provider.toUpperCase()} Realtime Client`);

    // 根據 provider 設定音訊取樣率
    // OpenAI: 24kHz, Gemini: 16kHz
    const sampleRate = provider === 'openai' ? 24000 : 16000;
    setTargetSampleRate(sampleRate);

    return createRealtimeClient({
        provider,
        apiKey,
        sourceLang: CONFIG.languages.defaultSource,
        targetLang: CONFIG.languages.defaultTarget,
        autoReconnect: true,
        openaiModel: CONFIG.realtime.openai.model,
        geminiModel: CONFIG.realtime.gemini.model,
    });
}

const realtimeClient = initRealtimeClient();

// 初始化翻譯服務（Prompt 設定在 services/translationService.ts）
const translationService = new TranslationService(process.env.OPENAI_API_KEY || '');

// 初始化 VectorStore（RAG 術語庫）— 非阻塞初始化
const vectorStore = (() => {
    try {
        const store = getVectorStore();
        store.init().then(() => {
            const stats = store.getStats();
            const total = Object.values(stats).reduce((a, b) => a + b, 0);
            if (total > 0) {
                console.log(`📚 [VectorStore] Ready: ${JSON.stringify(stats)}`);
            } else {
                console.log('📚 [VectorStore] Ready (empty — run seedGlossary.ts to load terms)');
            }
        }).catch(err => {
            console.warn('⚠️ [VectorStore] Init failed (RAG disabled):', err.message);
        });
        return store;
    } catch {
        console.warn('⚠️ [VectorStore] Not available (OPENAI_API_KEY missing?)');
        return null;
    }
})();

// 註冊 Gemini tool_call 事件處理（glossary lookup）
realtimeClient.on('tool_call', async (call: { id: string; name: string; args: Record<string, unknown> }) => {
    if (call.name === 'lookup_glossary' && vectorStore) {
        const query = String(call.args.query || '');
        // 取得當前 domain（從最近的 socket config）
        const configs = Array.from(socketConfigs.values());
        const currentDomain = (configs[configs.length - 1]?.domain || 'general') as DomainCode;

        console.log(`📚 [RAG] lookup_glossary("${query}") domain=${currentDomain}`);

        try {
            const results = await vectorStore.queryGlossary(currentDomain, query, 3);
            const glossaryResult = {
                terms: results.map(r => ({
                    term: r.entry.term,
                    termEn: r.entry.termEn,
                    definition: r.entry.definition,
                    score: Math.round(r.score * 100) / 100,
                })),
            };

            console.log(`📚 [RAG] Found ${results.length} terms:`, glossaryResult.terms.map(t => t.term));

            if (realtimeClient.sendToolResponse) {
                realtimeClient.sendToolResponse(call.id, glossaryResult);
            }
        } catch (err) {
            console.error('🚨 [RAG] Glossary lookup failed:', err);
            if (realtimeClient.sendToolResponse) {
                realtimeClient.sendToolResponse(call.id, { terms: [], error: 'lookup failed' });
            }
        }
    }
});

// 初始化 VAD 服務（過濾背景雜音）
const vadService = getVADService({
    energyThreshold: CONFIG.vad.energyThreshold,
    silenceFrameCount: CONFIG.vad.silenceFrameCount,
    speechFrameCount: CONFIG.vad.speechFrameCount,
});

// 初始化 OpenAI Chat API (用於語言偵測等)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

// Socket.io 設定，允許跨域
const io = new Server(httpServer, {
    cors: {
        origin: CONFIG.server.corsOrigins,
        methods: ['GET', 'POST'],
    },
});

// Express 中間件
app.use(cors());
app.use(express.json());

// 基本 API 路由
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        realtimeProvider: CONFIG.realtime.provider,
        connected: realtimeClient.isConnected,
    });
});

// 取得當前提供者資訊
app.get('/api/provider', (req, res) => {
    const sessionInfo = realtimeClient.getSessionInfo();
    res.json({
        provider: CONFIG.realtime.provider,
        model: sessionInfo.model,
        sessionId: sessionInfo.sessionId,
        connected: realtimeClient.isConnected,
        languages: realtimeClient.getLanguages(),
    });
});

// 取得所有支援的專業領域
app.get('/api/domains', (_req, res) => {
    res.json({ domains: getAllDomains() });
});

// 翻譯函數（委派給 TranslationService + RAG 術語查詢）
// 📝 修改翻譯 Prompt 請到 services/translationService.ts
async function translateText(
    text: string,
    sourceLang: LangCode,
    targetLang: LangCode,
    domain: DomainCode = 'general'
): Promise<{ translation: string; confidence?: 'high' | 'medium' | 'low' }> {
    // RAG：查詢相關術語注入 prompt
    let glossaryHints: Array<{ term: string; termEn: string; definition: string }> | undefined;
    if (vectorStore && domain !== 'general') {
        try {
            const results = await vectorStore.queryGlossary(domain, text, 3);
            if (results.length > 0) {
                glossaryHints = results.map(r => ({
                    term: r.entry.term,
                    termEn: r.entry.termEn,
                    definition: r.entry.definition,
                }));
                console.log(`📚 [RAG] Injecting ${glossaryHints.length} glossary terms into translation prompt`);
            }
        } catch (err) {
            console.warn('⚠️ [RAG] Glossary query failed, translating without RAG:', err);
        }
    }
    return translationService.translateText(text, sourceLang, targetLang, domain, glossaryHints);
}

// 記錄當前處理翻譯的 socket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentTranslationSocket: any = null;

// 新增：追蹤當前進行中的 streaming 翻譯狀態
interface StreamingState {
    id: string;                    // 這一段字幕的固定 ID
    timestamp: string;             // 時間戳
    lastSourceText: string;        // 目前累積的原文
    lastTranslatedLength: number;  // 上一次已翻譯到第幾個字
    currentTranslation: string;    // 目前的翻譯結果
    timer: NodeJS.Timeout | null;  // debounce 用的 Timeout handle
}
let currentStreamingState: StreamingState | null = null;

// 停頓偵測標記
let speechStoppedDetected = false;

// 翻譯觸發設定
const TRANSLATION_CHAR_THRESHOLD = 4;  // 每多 4 個字就翻譯一次
const TRANSLATION_DEBOUNCE_MS = 800;   // fallback: 800ms 沒有新字也翻譯

// 輕量即時翻譯函數（委派給 TranslationService）
// 📝 修改翻譯 Prompt 請到 services/translationService.ts
async function translateTextLight(
    text: string,
    sourceLang: LangCode,
    targetLang: LangCode,
    domain: DomainCode = 'general'
): Promise<string> {
    return translationService.translateTextLight(text, sourceLang, targetLang, domain);
}

// 註冊 Realtime API 文字回調 - 收到 AI 回覆時廣播給所有前端
realtimeClient.onText((text) => {
    console.log(`🤖 AI Response (Realtime): ${text}`);
    io.emit('message', {
        type: 'ai',
        content: `[AI] ${text}`,
        timestamp: new Date().toISOString(),
    });
});

// 註冊文字串流回調（可選：用於即時顯示打字效果）
realtimeClient.onTextDelta((delta) => {
    io.emit('message_delta', {
        type: 'ai',
        delta: delta,
        timestamp: new Date().toISOString(),
    });
});

// 語言偵測函數
async function detectLanguage(text: string): Promise<LangCode> {
    try {
        const response = await openai.chat.completions.create({
            model: CONFIG.languageDetection.model,
            messages: [
                {
                    role: 'system',
                    content: `偵測以下文字的語言，只回傳語言代碼，不要其他文字。
可能的語言代碼：${CONFIG.languages.codes.join('、')}
如果無法確定，回傳 ${CONFIG.languages.defaultSource}`,
                },
                {
                    role: 'user',
                    content: text,
                },
            ],
            temperature: CONFIG.languageDetection.temperature,
            max_tokens: CONFIG.languageDetection.maxTokens,
        });

        const detected = response.choices[0]?.message?.content?.trim() as LangCode;
        if (CONFIG.languages.codes.includes(detected)) {
            return detected;
        }
        return CONFIG.languages.defaultSource;
    } catch (error) {
        console.error('🚨 Language detection error:', error);
        return CONFIG.languages.defaultSource;
    }
}

// 註冊語音轉錄 Delta 回調 - 即時字幕（逐字出現 + 每 4 字翻譯）
realtimeClient.onTranscriptDelta((delta, accumulated) => {
    if (!currentTranslationSocket) {
        return;
    }
    const socket = currentTranslationSocket;

    const config = socketConfigs.get(socket.id) || {
        sourceLang: CONFIG.languages.defaultSource,
        targetLang: CONFIG.languages.defaultTarget,
        domain: 'general' as DomainCode,
    };

    // 如果沒有進行中的 streaming，建立新的
    if (!currentStreamingState) {
        currentStreamingState = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            lastSourceText: '',
            lastTranslatedLength: 0,
            currentTranslation: '',
            timer: null,
        };
        console.log(`🆕 New streaming state created: ${currentStreamingState.id}`);
    }

    const state = currentStreamingState;

    // 只在有新內容時處理
    if (accumulated !== state.lastSourceText) {
        state.lastSourceText = accumulated;

        // 立即發送 partial - 顯示正在辨識的文字（用目前已有的翻譯）
        socket.emit('translate_partial', {
            id: state.id,
            sourceText: accumulated,
            targetText: state.currentTranslation || '辨識中...',
            sourceLang: config.sourceLang,
            targetLang: config.targetLang,
            isReverse: false,
            isStreaming: true,
            timestamp: state.timestamp,
        });

        // 計算新增了多少字
        const deltaChars = accumulated.length - state.lastTranslatedLength;
        console.log(`📝 Delta: +${delta.length} chars, total: ${accumulated.length}, since last translate: ${deltaChars}`);

        // 如果新增字數 >= 4，立刻翻譯
        if (deltaChars >= TRANSLATION_CHAR_THRESHOLD) {
            // 取消舊的 timer
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }

            // 立刻翻譯
            const currentAccumulated = accumulated;
            const currentStateId = state.id;

            (async () => {
                try {
                    console.log(`🔄 Threshold translation (${deltaChars} chars): "${currentAccumulated}"`);
                    const translation = await translateTextLight(
                        currentAccumulated,
                        config.sourceLang,
                        config.targetLang,
                        config.domain
                    );

                    // 確認狀態還存在且是同一個 ID
                    if (currentStreamingState && currentStreamingState.id === currentStateId) {
                        currentStreamingState.lastTranslatedLength = currentAccumulated.length;
                        currentStreamingState.currentTranslation = translation;

                        socket.emit('translate_partial', {
                            id: currentStateId,
                            sourceText: currentAccumulated,
                            targetText: translation,
                            sourceLang: config.sourceLang,
                            targetLang: config.targetLang,
                            isReverse: false,
                            isStreaming: true,
                            timestamp: currentStreamingState.timestamp,
                        });
                        console.log(`✅ Streaming translation: "${currentAccumulated}" → "${translation}"`);
                    }
                } catch (error) {
                    console.error('🚨 Threshold translation error:', error);
                }
            })();
        } else {
            // 新增字數 < 4，設定 fallback timer（800ms 後翻譯）
            if (state.timer) {
                clearTimeout(state.timer);
            }

            const currentAccumulated = accumulated;
            const currentStateId = state.id;

            state.timer = setTimeout(async () => {
                // 確認狀態還存在且有新內容需要翻譯
                if (!currentStreamingState || currentStreamingState.id !== currentStateId) {
                    return;
                }
                if (currentAccumulated.length <= currentStreamingState.lastTranslatedLength) {
                    return;
                }

                try {
                    console.log(`🔄 Fallback translation (${TRANSLATION_DEBOUNCE_MS}ms): "${currentAccumulated}"`);
                    const translation = await translateTextLight(
                        currentAccumulated,
                        config.sourceLang,
                        config.targetLang,
                        config.domain
                    );

                    if (currentStreamingState && currentStreamingState.id === currentStateId) {
                        currentStreamingState.lastTranslatedLength = currentAccumulated.length;
                        currentStreamingState.currentTranslation = translation;

                        socket.emit('translate_partial', {
                            id: currentStateId,
                            sourceText: currentAccumulated,
                            targetText: translation,
                            sourceLang: config.sourceLang,
                            targetLang: config.targetLang,
                            isReverse: false,
                            isStreaming: true,
                            timestamp: currentStreamingState.timestamp,
                        });
                        console.log(`✅ Fallback translation: "${currentAccumulated}" → "${translation}"`);
                    }
                } catch (error) {
                    console.error('🚨 Fallback translation error:', error);
                }
            }, TRANSLATION_DEBOUNCE_MS);
        }
    }
});

// 註冊語音開始回調 - 重置 streaming 狀態
realtimeClient.onSpeechStarted(() => {
    console.log('🎤 Speech started - resetting streaming state');
    // 清除舊的 timer
    if (currentStreamingState?.timer) {
        clearTimeout(currentStreamingState.timer);
    }
    currentStreamingState = null;
    speechStoppedDetected = false; // 重置停頓標記
});

// 註冊語音停止回調 - 設置停頓標記
realtimeClient.onSpeechStopped(() => {
    console.log('🔇 Speech stopped detected - marking paragraph end');
    speechStoppedDetected = true;
});

// 註冊語音轉錄回調 - 處理最終翻譯（含自動語言偵測）
realtimeClient.onTranscript(async (transcript) => {
    console.log(`🎤 Transcript final: ${transcript}`);

    // 過濾空的 transcript
    if (!transcript || transcript.trim() === '') {
        console.log('⚠️ Empty transcript, skipping');
        return;
    }

    // 取得當前 socket 的設定
    if (!currentTranslationSocket) {
        console.log('⚠️ No socket for translation');
        return;
    }
    const socket = currentTranslationSocket;

    const config = socketConfigs.get(socket.id) || {
        sourceLang: CONFIG.languages.defaultSource,
        targetLang: CONFIG.languages.defaultTarget,
        domain: 'general' as DomainCode,
    };

    // 立即捕獲當前狀態，避免異步期間狀態被其他 transcript 修改
    const capturedStreamingState = currentStreamingState;
    const capturedSpeechStopped = speechStoppedDetected;

    // 生成唯一 ID：優先使用 streaming 的 ID，否則生成新的
    // 注意：每個 transcript 必須有唯一的 ID
    const translationId = capturedStreamingState?.id ||
        `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = capturedStreamingState?.timestamp || new Date().toISOString();

    // 立即清除 streaming 狀態，讓下一個 transcript 使用新 ID
    if (capturedStreamingState?.timer) {
        clearTimeout(capturedStreamingState.timer);
    }
    currentStreamingState = null;
    speechStoppedDetected = false;

    console.log(`🆔 Translation ID: ${translationId}, isParagraphEnd: ${capturedSpeechStopped}`);

    // 偵測語言
    const detectedLang = await detectLanguage(transcript);
    console.log(`🔍 Detected language: ${detectedLang}`);

    // 判斷方向：
    //   1. 若有明確的 audioSource（雙流模式），system = 對方說的（反向），mic = 自己說的（正向）
    //   2. 否則回落至語言偵測
    let isReverse: boolean;
    if (config.audioSource === 'system') {
        isReverse = true;
        console.log(`🔄 Dual-stream: system audio → reverse mode`);
    } else if (config.audioSource === 'mic') {
        isReverse = false;
        console.log(`➡️  Dual-stream: mic audio → forward mode`);
    } else {
        isReverse = detectedLang === config.targetLang ||
            (detectedLang !== config.sourceLang && detectedLang !== 'zh-TW');
    }

    let actualSourceLang: LangCode;
    let actualTargetLang: LangCode;

    if (isReverse) {
        actualSourceLang = config.targetLang;
        actualTargetLang = config.sourceLang;
        console.log(`🔄 Reverse mode: ${actualSourceLang} -> ${actualTargetLang}`);
    } else {
        actualSourceLang = config.sourceLang;
        actualTargetLang = config.targetLang;
        console.log(`➡️ Forward mode: ${actualSourceLang} -> ${actualTargetLang}`);
    }

    // 發送 partial - 原文已確定，正在做最終翻譯
    socket.emit('translate_partial', {
        id: translationId,
        sourceText: isReverse ? '翻譯中...' : transcript,
        targetText: isReverse ? transcript : '翻譯中...',
        sourceLang: config.sourceLang,
        targetLang: config.targetLang,
        isReverse,
        isStreaming: false,
        timestamp,
    });

    // 正式翻譯（使用完整的 translateText 函數）
    console.log(`🌐 Final translating: ${actualSourceLang} -> ${actualTargetLang} [${config.domain}]`);
    const result = await translateText(transcript, actualSourceLang, actualTargetLang, config.domain);
    const translatedText = result.translation;
    const confidence = result.confidence;
    console.log(`🌐 Final translated: ${translatedText} (confidence: ${confidence || 'N/A'})`);

    // 使用捕獲的停頓標記（已在函數開頭捕獲）
    const isParagraphEnd = capturedSpeechStopped;
    console.log(`📌 isParagraphEnd: ${isParagraphEnd}`);

    // 發送 final - 完整翻譯結果
    const translationEntry = {
        id: translationId,
        sourceText: isReverse ? translatedText : transcript,
        targetText: isReverse ? transcript : translatedText,
        sourceLang: config.sourceLang,
        targetLang: config.targetLang,
        isReverse,
        timestamp,
        isParagraphEnd,  // 新增：段落結束標記
        confidence,      // 新增：翻譯信心度
    };

    socket.emit('translate_final', translationEntry);
    socket.emit('translation', translationEntry);

    // ---- 會議記錄：加入逐字稿 ----
    const meetingId = socketMeetings.get(socket.id);
    if (meetingId) {
        getMeetingService().addUtterance(meetingId, {
            speaker: isReverse ? 'target' : 'source',
            sourceText: transcript,
            translatedText,
            sourceLang: actualSourceLang,
            targetLang: actualTargetLang,
            isReverse,
            confidence,
        });
    }
});

// Socket.io 連線處理
io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // 初始化預設語言設定
    socketConfigs.set(socket.id, {
        sourceLang: CONFIG.languages.defaultSource,
        targetLang: CONFIG.languages.defaultTarget,
        domain: 'general' as DomainCode,
    });

    // 歡迎訊息
    socket.emit('message', {
        type: 'system',
        content: `歡迎！你的連線 ID: ${socket.id}`,
        timestamp: new Date().toISOString(),
    });

    // 廣播給其他使用者
    socket.broadcast.emit('message', {
        type: 'system',
        content: `新使用者加入: ${socket.id}`,
        timestamp: new Date().toISOString(),
    });

    // 監聽語言設定更新
    socket.on('config:update', (data: { sourceLang: LangCode; targetLang: LangCode; domain?: string }) => {
        const domain = (data.domain && isValidDomain(data.domain)) ? data.domain as DomainCode : 'general';
        console.log(`🌐 Config update from ${socket.id}: ${data.sourceLang} -> ${data.targetLang} [${domain}]`);
        socketConfigs.set(socket.id, {
            sourceLang: data.sourceLang,
            targetLang: data.targetLang,
            domain,
        });
    });

    // 監聯客戶端發送的訊息
    socket.on('sendMessage', (data: { content: string }) => {
        console.log(`📨 Message from ${socket.id}: ${data.content}`);

        // 1. 廣播使用者訊息給所有連線的客戶端
        io.emit('message', {
            type: 'user',
            senderId: socket.id,
            content: data.content,
            timestamp: new Date().toISOString(),
        });

        // 2. 透過 Realtime API 發送訊息給 AI
        console.log('🤖 Sending to OpenAI Realtime API...');
        realtimeClient.sendUserMessage(data.content);
        // AI 回覆會透過 onText 回調自動廣播
    });

    // 定時轉換並發送音訊的 interval（讓 Server VAD 即時運作）
    let audioConversionInterval: NodeJS.Timeout | null = null;
    let isConverting = false;

    const startAudioConversionInterval = () => {
        if (audioConversionInterval) return;

        audioConversionInterval = setInterval(async () => {
            // 防止重複轉換
            if (isConverting) return;

            // 檢查是否有足夠的新資料
            if (!hasEnoughNewData(CONFIG.audio.minBytesForConversion)) return;

            isConverting = true;
            try {
                const pcmBuffer = await convertAccumulatedIncrementally();
                if (pcmBuffer && pcmBuffer.length > 0) {
                    // VAD 檢查：過濾背景雜音
                    if (CONFIG.vad.enabled) {
                        const hasSpeech = vadService.isSpeechDetected(pcmBuffer);
                        const status = vadService.getStatus(pcmBuffer);

                        if (!hasSpeech) {
                            console.log(`🔇 VAD: No speech (energy: ${status.energy.toFixed(4)}) - skipping`);
                            return;
                        }
                        console.log(`🎤 VAD: Speech detected (energy: ${status.energy.toFixed(4)})`);
                    }

                    console.log(`📤 Sending incremental audio: ${pcmBuffer.length} bytes`);
                    realtimeClient.sendAudioChunk(pcmBuffer);
                }
            } catch (error) {
                console.error('🚨 Incremental conversion failed:', error);
            } finally {
                isConverting = false;
            }
        }, CONFIG.audio.conversionIntervalMs);
    };

    const stopAudioConversionInterval = () => {
        if (audioConversionInterval) {
            clearInterval(audioConversionInterval);
            audioConversionInterval = null;
        }
    };

    // 監聽音訊資料 (連續錄音模式，累積 webm 片段)
    socket.on('audio:chunk', async (payload: ArrayBuffer | { buffer: ArrayBuffer; source?: 'mic' | 'system' }) => {
        // 兼容舊格式（純 ArrayBuffer）與新格式（{ buffer, source }）
        let buffer: ArrayBuffer;
        let source: 'mic' | 'system' = 'mic';

        if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
            buffer = payload instanceof ArrayBuffer ? payload : (payload as ArrayBufferView).buffer;
        } else if (payload && typeof payload === 'object' && 'buffer' in payload) {
            buffer = (payload as { buffer: ArrayBuffer }).buffer;
            source = (payload as { buffer: ArrayBuffer; source?: 'mic' | 'system' }).source ?? 'mic';
        } else {
            buffer = payload as unknown as ArrayBuffer;
        }

        console.log(`🎤 Received audio chunk from ${socket.id}: ${buffer.byteLength} bytes [source=${source}]`);

        // 記錄當前處理的 socket 及音訊來源
        currentTranslationSocket = socket;
        const currentConfig = socketConfigs.get(socket.id);
        if (currentConfig) {
            currentConfig.audioSource = source;
        }

        // 累積 webm 片段
        appendAudioChunk(buffer);

        // 確保定時轉換已啟動
        startAudioConversionInterval();
    });

    // 監聽音訊提交事件 (停止錄音時觸發)
    socket.on('audio:commit', async () => {
        console.log(`📤 Audio commit from ${socket.id}`);
        currentTranslationSocket = socket;

        // 停止定時轉換
        stopAudioConversionInterval();

        try {
            // 將累積的完整 webm 轉換為 PCM16
            const pcmBuffer = await convertAccumulatedToPCM16();

            if (pcmBuffer && pcmBuffer.length > 0) {
                // 發送剩餘音訊到 Realtime API
                realtimeClient.sendAudioChunk(pcmBuffer);

                // 提交並請求回應（處理最後一段）
                realtimeClient.commitAudioAndRespond();
            }
        } catch (error) {
            console.error('🚨 Failed to convert audio:', error);
            socket.emit('message', {
                type: 'system',
                content: '音訊轉換失敗，請確認已安裝 ffmpeg',
                timestamp: new Date().toISOString(),
            });
            // 重置 buffer
            resetAudioBuffer();
        }
    });

    // 監聽開始錄音事件
    socket.on('audio:start', () => {
        console.log(`🎤 Audio recording started from ${socket.id}`);
        currentTranslationSocket = socket; // 記錄當前 socket
        resetAudioBuffer();
        stopAudioConversionInterval();
        // 重置 streaming 狀態，準備新的語音輸入
        currentStreamingState = null;
        // 重置 VAD 狀態
        vadService.reset();
    });

    // ---- 會議管理事件 ----

    // 追蹤本 socket 的活躍會議 ID
    let activeMeetingId: string | null = null;

    /** 開始會議 */
    socket.on('meeting:start', (data: { domain?: string }) => {
        const config = socketConfigs.get(socket.id);
        const domain: DomainCode = (data?.domain && isValidDomain(data.domain))
            ? data.domain as DomainCode
            : (config?.domain ?? 'general');

        activeMeetingId = getMeetingService().startMeeting(domain);
        socketMeetings.set(socket.id, activeMeetingId);
        console.log(`📋 Meeting started [${socket.id}]: ${activeMeetingId}`);
        socket.emit('meeting:started', { meetingId: activeMeetingId, domain });
    });

    /** 結束會議（不自動生成摘要，讓前端決定） */
    socket.on('meeting:end', () => {
        if (!activeMeetingId) {
            socket.emit('meeting:error', { message: '沒有進行中的會議' });
            return;
        }
        const record = getMeetingService().endMeeting(activeMeetingId);
        console.log(`📋 Meeting ended [${socket.id}]: ${activeMeetingId}`);
        socket.emit('meeting:ended', {
            meetingId: activeMeetingId,
            utteranceCount: record?.utterances.length ?? 0,
        });
        socketMeetings.delete(socket.id);
        activeMeetingId = null;
    });

    /** 生成摘要 */
    socket.on('meeting:summarize', async (data: { meetingId?: string }) => {
        const targetId = data?.meetingId ?? activeMeetingId;
        if (!targetId) {
            socket.emit('meeting:error', { message: '沒有指定會議 ID' });
            return;
        }

        console.log(`📝 Generating summary for ${targetId}...`);
        socket.emit('meeting:summary_generating', { meetingId: targetId });

        const summary = await getMeetingService().generateSummary(targetId);
        if (summary) {
            socket.emit('meeting:summary', { meetingId: targetId, summary });
        } else {
            socket.emit('meeting:error', { message: '摘要生成失敗，請確認 GEMINI_API_KEY 已設定' });
        }
    });

    /** 取得逐字稿 */
    socket.on('meeting:transcript', (data: { meetingId?: string }) => {
        const targetId = data?.meetingId ?? activeMeetingId;
        if (!targetId) {
            socket.emit('meeting:error', { message: '沒有指定會議 ID' });
            return;
        }
        const record = getMeetingService().getMeetingTranscript(targetId);
        socket.emit('meeting:transcript_result', { meetingId: targetId, record });
    });

    // 斷線處理
    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        // 停止定時轉換
        stopAudioConversionInterval();
        // 清理設定
        socketConfigs.delete(socket.id);
        socketMeetings.delete(socket.id);
        if (currentTranslationSocket?.id === socket.id) {
            currentTranslationSocket = null;
        }
        io.emit('message', {
            type: 'system',
            content: `使用者離開: ${socket.id}`,
            timestamp: new Date().toISOString(),
        });
    });
});

// 啟動伺服器
const PORT = process.env.PORT || 3001;

async function startServer() {
    try {
        // 檢查 ffmpeg 是否可用
        const ffmpegAvailable = await checkFFmpeg();
        if (ffmpegAvailable) {
            console.log('✅ ffmpeg is available');
        } else {
            console.warn('⚠️ ffmpeg not found - audio conversion will fail');
            console.warn('   Install with: brew install ffmpeg (macOS)');
        }

        // 先連接 OpenAI Realtime API
        await realtimeClient.connect();
        console.log('🤖 OpenAI Realtime API connected');

        // 啟動 HTTP 伺服器
        httpServer.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`📡 Socket.io ready for connections`);
            console.log(`🤖 OpenAI Realtime integration: Enabled`);
        });
    } catch (error) {
        console.error('🚨 Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

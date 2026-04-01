/**
 * 即時翻譯客戶端工廠
 * 支援 OpenAI 和 Gemini 兩種方案
 */

import { IRealtimeClient, IRealtimeClientOptions, RealtimeProvider } from './types';
import { OpenAIRealtimeClient, RealtimeClientOptions as OpenAIOptions } from './openaiRealtimeClient';
import { GeminiRealtimeClient, GeminiRealtimeClientOptions } from './geminiRealtimeClient';

export interface RealtimeClientFactoryOptions extends IRealtimeClientOptions {
    provider: RealtimeProvider;
    // OpenAI 特有選項
    openaiModel?: string;
    // Gemini 特有選項
    geminiModel?: string;
    voice?: string;
    domain?: string;
}

/**
 * 建立即時翻譯客戶端
 */
export function createRealtimeClient(options: RealtimeClientFactoryOptions): IRealtimeClient {
    const { provider, apiKey, sourceLang, targetLang, autoReconnect } = options;

    switch (provider) {
        case 'openai': {
            const openaiOptions: OpenAIOptions = {
                apiKey,
                model: options.openaiModel,
                sourceLang,
                targetLang,
                autoReconnect,
                domain: options.domain,
            };
            console.log('🏭 Creating OpenAI Realtime Client');
            return new OpenAIRealtimeClient(openaiOptions as any);
        }

        case 'gemini': {
            const geminiOptions: GeminiRealtimeClientOptions = {
                apiKey,
                model: options.geminiModel,
                sourceLang,
                targetLang,
                autoReconnect,
                voice: options.voice,
                domain: options.domain,
            };
            console.log('🏭 Creating Gemini Realtime Client');
            return new GeminiRealtimeClient(geminiOptions);
        }

        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * 從環境變數建立客戶端
 */
export function createRealtimeClientFromEnv(
    provider?: RealtimeProvider,
    options?: Partial<Omit<RealtimeClientFactoryOptions, 'provider' | 'apiKey'>>
): IRealtimeClient {
    const selectedProvider = provider || (process.env.REALTIME_PROVIDER as RealtimeProvider) || 'openai';

    let apiKey: string;

    if (selectedProvider === 'openai') {
        apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }
    } else if (selectedProvider === 'gemini') {
        apiKey = process.env.GOOGLE_API_KEY || '';
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY environment variable is required');
        }
    } else {
        throw new Error(`Unknown provider: ${selectedProvider}`);
    }

    // Gemini 模型優先使用 GEMINI_LIVE_MODEL（新），然後是 GEMINI_MODEL（舊）
    const geminiModel = options?.geminiModel || 
                        process.env.GEMINI_LIVE_MODEL || 
                        process.env.GEMINI_MODEL ||
                        'gemini-3-flash-preview';

    return createRealtimeClient({
        provider: selectedProvider,
        apiKey,
        sourceLang: options?.sourceLang || process.env.SOURCE_LANG || 'zh-TW',
        targetLang: options?.targetLang || process.env.TARGET_LANG || 'en',
        autoReconnect: options?.autoReconnect ?? true,
        openaiModel: options?.openaiModel || process.env.OPENAI_MODEL,
        geminiModel,
        voice: options?.voice || process.env.GEMINI_VOICE,
    });
}

// 匯出所有相關類型和類別
export { OpenAIRealtimeClient } from './openaiRealtimeClient';
export { GeminiRealtimeClient } from './geminiRealtimeClient';
export * from './types';

/**
 * 翻譯服務
 * 
 * 包含所有翻譯相關的函數和 Prompt 設定
 * 修改翻譯 Prompt 請在此檔案中修改
 */

import OpenAI from 'openai';
import { getTranslationCache } from './translationCache';

// 語言代碼類型
export type LangCode = 'zh-TW' | 'en' | 'vi' | 'id' | 'th' | 'ja' | 'ko';

// 語言名稱對照表
export const LANGUAGE_NAMES: Record<LangCode, string> = {
    'zh-TW': '繁體中文',
    'en': '英文',
    'ja': '日文',
    'ko': '韓文',
    'vi': '越南文',
    'id': '印尼文',
    'th': '泰文',
};

// ============ 翻譯設定 ============
export const TRANSLATION_CONFIG = {
    // 正式翻譯設定
    full: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 500,
    },
    // 輕量即時翻譯設定
    light: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 200,
    },
};

// ============ 翻譯 Prompt 模板 ============
// 修改翻譯行為請在這裡調整

/**
 * 正式翻譯 Prompt（用於最終翻譯結果）
 */
export function getFullTranslationPrompt(sourceLang: LangCode, targetLang: LangCode): string {
    const sourceLanguage = LANGUAGE_NAMES[sourceLang];
    const targetLanguage = LANGUAGE_NAMES[targetLang];

    return `你是一個專業的醫療翻譯。將以下${sourceLanguage}翻譯成${targetLanguage}。

重要規則：
1. 只輸出${targetLanguage}，禁止混合其他語言
2. 必須翻譯每一個字，不能保留任何原文
3. 如果某個詞沒有直接對應，使用最接近的${targetLanguage}表達
4. 人名請音譯成${targetLanguage}
5. 保持原文的語氣和意思
6. 只回傳翻譯結果，不要加任何解釋`;
}

/**
 * 輕量翻譯 Prompt（用於即時串流翻譯）
 */
export function getLightTranslationPrompt(sourceLang: LangCode, targetLang: LangCode): string {
    const sourceLanguage = LANGUAGE_NAMES[sourceLang];
    const targetLanguage = LANGUAGE_NAMES[targetLang];

    return `快速翻譯：${sourceLanguage}→${targetLanguage}。規則：1.只輸出${targetLanguage} 2.翻譯每個字，禁止保留原文 3.只回傳翻譯`;
}

// ============ 翻譯服務類別 ============
export class TranslationService {
    private openai: OpenAI;
    private cache = getTranslationCache();

    constructor(apiKey: string) {
        this.openai = new OpenAI({ apiKey });
    }

    /**
     * 正式翻譯（品質優先）
     * 用於最終翻譯結果
     */
    async translateText(
        text: string,
        sourceLang: LangCode,
        targetLang: LangCode
    ): Promise<string> {
        if (sourceLang === targetLang || !text.trim()) {
            return text;
        }

        // 檢查快取
        const cached = this.cache.get(text, sourceLang, targetLang);
        if (cached) {
            console.log('📦 Translation cache hit:', text.substring(0, 20) + '...');
            return cached;
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: TRANSLATION_CONFIG.full.model,
                messages: [
                    {
                        role: 'system',
                        content: getFullTranslationPrompt(sourceLang, targetLang),
                    },
                    {
                        role: 'user',
                        content: text,
                    },
                ],
                temperature: TRANSLATION_CONFIG.full.temperature,
                max_tokens: TRANSLATION_CONFIG.full.maxTokens,
            });

            const result = response.choices[0]?.message?.content || text;

            // 儲存到快取
            this.cache.set(text, sourceLang, targetLang, result);

            return result;
        } catch (error) {
            console.error('🚨 Translation error:', error);
            return `[翻譯失敗] ${text}`;
        }
    }

    /**
     * 輕量翻譯（速度優先）
     * 用於即時串流翻譯
     */
    async translateTextLight(
        text: string,
        sourceLang: LangCode,
        targetLang: LangCode
    ): Promise<string> {
        if (sourceLang === targetLang || !text.trim()) {
            return text;
        }

        // 檢查快取
        const cached = this.cache.get(text, sourceLang, targetLang);
        if (cached) {
            return cached;
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: TRANSLATION_CONFIG.light.model,
                messages: [
                    {
                        role: 'system',
                        content: getLightTranslationPrompt(sourceLang, targetLang),
                    },
                    {
                        role: 'user',
                        content: text,
                    },
                ],
                temperature: TRANSLATION_CONFIG.light.temperature,
                max_tokens: TRANSLATION_CONFIG.light.maxTokens,
            });

            const result = response.choices[0]?.message?.content || text;

            // 儲存到快取
            this.cache.set(text, sourceLang, targetLang, result);

            return result;
        } catch (error) {
            console.error('🚨 Light translation error:', error);
            return '翻譯中...';
        }
    }

    /**
     * 取得快取統計
     */
    getCacheMetrics() {
        return this.cache.getMetrics();
    }

    /**
     * 清空快取
     */
    clearCache() {
        this.cache.clear();
    }
}

// 預設導出單例工廠函數
let translationServiceInstance: TranslationService | null = null;

export function getTranslationService(apiKey?: string): TranslationService {
    if (!translationServiceInstance) {
        if (!apiKey) {
            throw new Error('TranslationService requires API key for initialization');
        }
        translationServiceInstance = new TranslationService(apiKey);
    }
    return translationServiceInstance;
}

export default TranslationService;

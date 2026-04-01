/**
 * 翻譯服務
 * 
 * 包含所有翻譯相關的函數和 Prompt 設定
 * 修改翻譯 Prompt 請在此檔案中修改
 */

import OpenAI from 'openai';
import { getTranslationCache } from './translationCache';
import { type DomainCode, getDomainConfig, getCommonSafetyRules } from './domainService';

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
 * @param domain - 專業領域，影響 prompt 上下文和術語選擇
 * @param glossaryHints - RAG 查詢到的術語提示（可選）
 */
export function getFullTranslationPrompt(
    sourceLang: LangCode,
    targetLang: LangCode,
    domain: DomainCode = 'general',
    glossaryHints?: Array<{ term: string; termEn: string; definition: string }>
): string {
    const sourceLanguage = LANGUAGE_NAMES[sourceLang];
    const targetLanguage = LANGUAGE_NAMES[targetLang];
    const domainConfig = getDomainConfig(domain);
    const safetyRules = getCommonSafetyRules();

    const glossarySection = glossaryHints && glossaryHints.length > 0
        ? `\n參考術語（請優先使用這些專業翻譯）：\n${glossaryHints.map(g => `- ${g.term} → ${g.termEn}：${g.definition}`).join('\n')}\n`
        : '';

    return `你是一個專業的${domainConfig.name}領域口譯員兼記錄員。你的任務是將${sourceLanguage}翻譯成${targetLanguage}。

領域上下文：${domainConfig.promptFragment}
${glossarySection}
翻譯規則：
1. 理解說話者的意圖，將口語化、不完整的表達改寫為專業、完整的${targetLanguage}句子
2. 去除口語贅詞（嗯、那個、就是...），補全語意
3. 使用該領域的專業術語
4. 只輸出${targetLanguage}，禁止混合其他語言
5. 人名請音譯成${targetLanguage}
6. 數字、日期、金額等必須 100% 保真

${safetyRules}
${domainConfig.safetyHint ? '領域安全：' + domainConfig.safetyHint : ''}

輸出格式（JSON）：
{"translation": "翻譯結果", "confidence": "high|medium|low"}
- high: 語意清楚，翻譯有把握
- medium: 語意大致可理解，部分推測
- low: 語意不完整，需要猜測意圖

只回傳 JSON，不要加任何額外說明。`;
}

/**
 * 輕量翻譯 Prompt（用於即時串流翻譯）
 * @param domain - 專業領域
 */
export function getLightTranslationPrompt(sourceLang: LangCode, targetLang: LangCode, domain: DomainCode = 'general'): string {
    const sourceLanguage = LANGUAGE_NAMES[sourceLang];
    const targetLanguage = LANGUAGE_NAMES[targetLang];
    const domainConfig = getDomainConfig(domain);

    return `你是${domainConfig.name}領域口譯員。快速翻譯：${sourceLanguage}→${targetLanguage}。規則：1.只輸出${targetLanguage} 2.理解意圖，用專業術語改寫 3.只回傳翻譯`;
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
     * 用於最終翻譯結果，回傳翻譯 + 信心度
     * @param glossaryHints - RAG 查詢到的術語提示（可選）
     */
    async translateText(
        text: string,
        sourceLang: LangCode,
        targetLang: LangCode,
        domain: DomainCode = 'general',
        glossaryHints?: Array<{ term: string; termEn: string; definition: string }>
    ): Promise<{ translation: string; confidence?: 'high' | 'medium' | 'low' }> {
        if (sourceLang === targetLang || !text.trim()) {
            return { translation: text, confidence: 'high' };
        }

        // 檢查快取
        const cached = this.cache.get(text, sourceLang, targetLang);
        if (cached) {
            console.log('📦 Translation cache hit:', text.substring(0, 20) + '...');
            try {
                const parsed = JSON.parse(cached);
                return { translation: parsed.translation || cached, confidence: parsed.confidence };
            } catch {
                return { translation: cached, confidence: 'high' };
            }
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: TRANSLATION_CONFIG.full.model,
                messages: [
                    {
                        role: 'system',
                        content: getFullTranslationPrompt(sourceLang, targetLang, domain, glossaryHints),
                    },
                    {
                        role: 'user',
                        content: text,
                    },
                ],
                temperature: TRANSLATION_CONFIG.full.temperature,
                max_tokens: TRANSLATION_CONFIG.full.maxTokens,
            });

            const raw = response.choices[0]?.message?.content || text;

            // 嘗試解析 JSON 結構化輸出
            try {
                const parsed = JSON.parse(raw);
                const translation = parsed.translation || raw;
                const confidence = parsed.confidence || 'high';
                // 快取原始 JSON
                this.cache.set(text, sourceLang, targetLang, raw);
                return { translation, confidence };
            } catch {
                // LLM 沒有回傳 JSON，直接使用文字
                this.cache.set(text, sourceLang, targetLang, raw);
                return { translation: raw, confidence: 'high' };
            }
        } catch (error) {
            console.error('🚨 Translation error:', error);
            return { translation: `[翻譯失敗] ${text}`, confidence: 'low' };
        }
    }

    /**
     * 輕量翻譯（速度優先）
     * 用於即時串流翻譯
     */
    async translateTextLight(
        text: string,
        sourceLang: LangCode,
        targetLang: LangCode,
        domain: DomainCode = 'general'
    ): Promise<string> {
        if (sourceLang === targetLang || !text.trim()) {
            return text;
        }

        // 檢查快取
        const cached = this.cache.get(text, sourceLang, targetLang);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                return parsed.translation || cached;
            } catch {
                return cached;
            }
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: TRANSLATION_CONFIG.light.model,
                messages: [
                    {
                        role: 'system',
                        content: getLightTranslationPrompt(sourceLang, targetLang, domain),
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

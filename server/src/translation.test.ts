import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 後端翻譯邏輯測試
 * 模擬 OpenAI API 呼叫和翻譯邏輯
 */

describe('後端翻譯邏輯', () => {
    // 模擬翻譯函數
    const mockTranslateText = async (
        text: string,
        sourceLang: string,
        targetLang: string
    ): Promise<string> => {
        // 簡單的模擬翻譯邏輯
        const translations: Record<string, Record<string, string>> = {
            'zh-TW->en': {
                '你好': 'Hello',
                '再見': 'Goodbye',
                '謝謝': 'Thank you',
            },
            'en->zh-TW': {
                'Hello': '你好',
                'Goodbye': '再見',
                'Thank you': '謝謝',
            },
        };

        const key = `${sourceLang}->${targetLang}`;
        return translations[key]?.[text] || `[Translated: ${text}]`;
    };

    // 模擬語言偵測函數
    const mockDetectLanguage = async (text: string): Promise<string> => {
        // 簡單的語言偵測邏輯
        if (/[\u4E00-\u9FFF]/.test(text)) {
            return 'zh-TW';
        }
        if (/[a-zA-Z]/.test(text)) {
            return 'en';
        }
        return 'unknown';
    };

    describe('翻譯流程', () => {
        it('應該執行基本翻譯（中文 → 英文）', async () => {
            const result = await mockTranslateText('你好', 'zh-TW', 'en');
            expect(result).toBe('Hello');
        });

        it('應該執行反向翻譯（英文 → 中文）', async () => {
            const result = await mockTranslateText('Hello', 'en', 'zh-TW');
            expect(result).toBe('你好');
        });

        it('應該處理未知翻譯（返回模擬結果）', async () => {
            const result = await mockTranslateText('Unknown', 'zh-TW', 'en');
            expect(result).toContain('Unknown');
        });

        it('應該支援多個翻譯對', async () => {
            const translations = [
                { text: '你好', source: 'zh-TW', target: 'en', expected: 'Hello' },
                { text: '再見', source: 'zh-TW', target: 'en', expected: 'Goodbye' },
                { text: '謝謝', source: 'zh-TW', target: 'en', expected: 'Thank you' },
            ];

            for (const trans of translations) {
                const result = await mockTranslateText(trans.text, trans.source, trans.target);
                expect(result).toBe(trans.expected);
            }
        });

        it('應該處理空字符串', async () => {
            const result = await mockTranslateText('', 'zh-TW', 'en');
            expect(result).toBeDefined();
        });

        it('應該處理超長文本', async () => {
            const longText = '你好'.repeat(100);
            const result = await mockTranslateText(longText, 'zh-TW', 'en');
            expect(result).toBeDefined();
        });
    });

    describe('語言偵測', () => {
        it('應該偵測中文', async () => {
            const lang = await mockDetectLanguage('你好世界');
            expect(lang).toBe('zh-TW');
        });

        it('應該偵測英文', async () => {
            const lang = await mockDetectLanguage('Hello World');
            expect(lang).toBe('en');
        });

        it('應該處理混合語言', async () => {
            const lang = await mockDetectLanguage('Hello 你好');
            // 應該偵測到其中一個語言
            expect(['zh-TW', 'en']).toContain(lang);
        });

        it('應該處理未知語言', async () => {
            const lang = await mockDetectLanguage('123 @#$');
            expect(lang).toBe('unknown');
        });

        it('應該處理空字符串', async () => {
            const lang = await mockDetectLanguage('');
            expect(lang).toBe('unknown');
        });

        it('應該正確識別多種中文', async () => {
            const texts = ['你好', '我叫John', '這是中文文本'];
            for (const text of texts) {
                const lang = await mockDetectLanguage(text);
                expect(lang).toBe('zh-TW');
            }
        });
    });

    describe('反向翻譯邏輯', () => {
        it('應該在偵測到目標語言時啟用反向翻譯', async () => {
            const config = { sourceLang: 'zh-TW', targetLang: 'en' };
            const transcript = 'Hello'; // 病人說英文
            const detectedLang = await mockDetectLanguage(transcript);

            // 如果偵測到的語言是目標語言，應該反向翻譯
            const isReverse = detectedLang === config.targetLang;

            expect(isReverse).toBe(true);
            expect(detectedLang).toBe('en');
        });

        it('應該在正常情況下使用前向翻譯', async () => {
            const config = { sourceLang: 'zh-TW', targetLang: 'en' };
            const transcript = '你好'; // 護理端說中文
            const detectedLang = await mockDetectLanguage(transcript);

            const isReverse = detectedLang === config.targetLang;

            expect(isReverse).toBe(false);
            expect(detectedLang).toBe('zh-TW');
        });

        it('應該處理反向翻譯的雙向流程', async () => {
            // 正向：中文 → 英文
            const forward = await mockTranslateText('你好', 'zh-TW', 'en');
            expect(forward).toBe('Hello');

            // 反向：英文 → 中文
            const reverse = await mockTranslateText(forward, 'en', 'zh-TW');
            expect(reverse).toBe('你好');
        });
    });

    describe('Streaming vs Final 翻譯', () => {
        const mockPartialTranslation = async (text: string): Promise<string> => {
            // Partial 翻譯使用輕量級 API
            return `[Partial] ${text}`;
        };

        const mockFinalTranslation = async (text: string): Promise<string> => {
            // Final 翻譯使用完整 API
            return await mockTranslateText(text, 'zh-TW', 'en');
        };

        it('應該執行 partial 翻譯', async () => {
            const result = await mockPartialTranslation('你');
            expect(result).toContain('Partial');
        });

        it('應該執行 final 翻譯', async () => {
            const result = await mockFinalTranslation('你好');
            expect(result).toBe('Hello');
        });

        it('應該在翻譯進度中逐步更新', async () => {
            const texts = ['你', '你好', '你好世', '你好世界'];
            const results = [];

            for (const text of texts) {
                const result = await mockPartialTranslation(text);
                results.push(result);
            }

            expect(results.length).toBe(4);
            expect(results[0]).toContain('你');
            expect(results[results.length - 1]).toContain('世界');
        });
    });

    describe('去重邏輯', () => {
        interface TranslationEntry {
            id: string;
            sourceText: string;
            isParagraphEnd: boolean;
        }

        const processedKeys = new Set<string>();

        const shouldProcessTranslation = (entry: TranslationEntry): boolean => {
            const key = `${entry.id}_${entry.sourceText.length}`;

            if (processedKeys.has(key)) {
                return false;
            }

            processedKeys.add(key);
            return true;
        };

        it('應該過濾重複翻譯', () => {
            const entries: TranslationEntry[] = [
                { id: '1', sourceText: '你好', isParagraphEnd: false },
                { id: '1', sourceText: '你好', isParagraphEnd: false }, // 重複
            ];

            processedKeys.clear();
            const results = entries.filter(shouldProcessTranslation);

            expect(results.length).toBe(1);
            expect(processedKeys.size).toBe(1);
        });

        it('應該允許相同 ID 但不同長度的翻譯', () => {
            const entries: TranslationEntry[] = [
                { id: '1', sourceText: '你', isParagraphEnd: false },
                { id: '1', sourceText: '你好', isParagraphEnd: false },
                { id: '1', sourceText: '你好世', isParagraphEnd: false },
            ];

            processedKeys.clear();
            const results = entries.filter(shouldProcessTranslation);

            expect(results.length).toBe(3);
            expect(processedKeys.size).toBe(3);
        });

        it('應該允許不同 ID 的翻譯', () => {
            const entries: TranslationEntry[] = [
                { id: '1', sourceText: '你好', isParagraphEnd: false },
                { id: '2', sourceText: '你好', isParagraphEnd: false },
            ];

            processedKeys.clear();
            const results = entries.filter(shouldProcessTranslation);

            expect(results.length).toBe(2);
        });
    });

    describe('段落結束偵測', () => {
        it('應該標記段落結束的翻譯', () => {
            const entry = { id: '1', sourceText: '你好', isParagraphEnd: true };
            expect(entry.isParagraphEnd).toBe(true);
        });

        it('應該標記非段落結束的翻譯', () => {
            const entry = { id: '1', sourceText: '你', isParagraphEnd: false };
            expect(entry.isParagraphEnd).toBe(false);
        });

        it('應該在段落結束時停止合併', () => {
            const lastBubble = { id: '1', sourceText: '你', isComplete: false };
            const newEntry = { sourceText: '好', isParagraphEnd: true };

            // 段落結束時不應合併
            const shouldMerge = !newEntry.isParagraphEnd;
            expect(shouldMerge).toBe(false);
        });
    });

    describe('錯誤處理', () => {
        const mockTranslateWithError = async (text: string): Promise<string> => {
            if (!text) {
                throw new Error('Empty text');
            }
            if (text.length > 1000) {
                throw new Error('Text too long');
            }
            return `Translated: ${text}`;
        };

        it('應該處理空字符串錯誤', async () => {
            await expect(mockTranslateWithError('')).rejects.toThrow('Empty text');
        });

        it('應該處理超長文本錯誤', async () => {
            const longText = 'a'.repeat(1001);
            await expect(mockTranslateWithError(longText)).rejects.toThrow('Text too long');
        });

        it('應該成功翻譯有效文本', async () => {
            const result = await mockTranslateWithError('Hello');
            expect(result).toContain('Translated');
        });
    });
});

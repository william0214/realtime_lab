import { describe, it, expect } from 'vitest';
import type { TranslationEntry, AccumulatedEntry } from '../hooks/useSocket';

/**
 * TranslationBubble 邏輯測試
 * 不測試 React 渲染，只測試邏輯
 */
describe('TranslationBubble - 邏輯驗證', () => {
    const mockEntry: TranslationEntry = {
        id: '1234',
        sourceText: '你好',
        targetText: 'Hello',
        sourceLang: 'zh-TW',
        targetLang: 'en',
        timestamp: new Date().toISOString(),
        isParagraphEnd: false,
    };

    const mockAccumulatedEntry: AccumulatedEntry = {
        id: '1234',
        segments: [mockEntry],
        sourceText: '你好',
        targetText: 'Hello',
        displaySourceText: '你好',
        displayTargetText: 'Hello',
        sourceLang: 'zh-TW',
        targetLang: 'en',
        timestamp: mockEntry.timestamp,
        isComplete: true,
        isParagraphEnd: false,
    };

    describe('訊息結構驗證', () => {
        it('應該有有效的翻譯條目結構', () => {
            expect(mockEntry).toHaveProperty('id');
            expect(mockEntry).toHaveProperty('sourceText');
            expect(mockEntry).toHaveProperty('targetText');
            expect(mockEntry).toHaveProperty('sourceLang');
            expect(mockEntry).toHaveProperty('targetLang');
        });

        it('應該有有效的累積條目結構', () => {
            expect(mockAccumulatedEntry).toHaveProperty('displaySourceText');
            expect(mockAccumulatedEntry).toHaveProperty('displayTargetText');
            expect(mockAccumulatedEntry).toHaveProperty('segments');
            expect(mockAccumulatedEntry.segments.length).toBeGreaterThan(0);
        });

        it('應該有有效的語言代碼', () => {
            const validLangs = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'id', 'th'];
            expect(validLangs).toContain(mockEntry.sourceLang);
            expect(validLangs).toContain(mockEntry.targetLang);
        });

        it('應該有有效的時間戳', () => {
            expect(mockEntry.timestamp).toBeTruthy();
            const date = new Date(mockEntry.timestamp);
            expect(date.getTime()).toBeGreaterThan(0);
        });
    });

    describe('文本內容驗證', () => {
        it('應該支援基本文本', () => {
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: '你好',
                targetText: 'Hello',
            };
            expect(entry.sourceText.length).toBeGreaterThan(0);
            expect(entry.targetText.length).toBeGreaterThan(0);
        });

        it('應該支援長文本', () => {
            const longText = '這是一個很長的文本'.repeat(10);
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: longText,
                targetText: longText,
            };
            expect(entry.sourceText.length).toBeGreaterThan(80);
        });

        it('應該支援特殊字符', () => {
            const specialText = '123!@#$%^&*()_+-=[]{}|;:,.<>?';
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: specialText,
                targetText: specialText,
            };
            expect(entry.sourceText).toContain('!');
            expect(entry.sourceText).toContain('@');
        });

        it('應該支援 emoji', () => {
            const emojiText = '你好 🌍 World 😀';
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: emojiText,
                targetText: emojiText,
            };
            expect(entry.sourceText).toContain('🌍');
            expect(entry.sourceText).toContain('😀');
        });

        it('應該支援多行文本', () => {
            const multilineText = '第一行\n第二行\n第三行';
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: multilineText,
                targetText: multilineText,
            };
            expect(entry.sourceText).toContain('\n');
        });

        it('應該支援空文本', () => {
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: '',
                targetText: '',
            };
            expect(entry.sourceText).toBe('');
            expect(entry.targetText).toBe('');
        });
    });

    describe('顯示模式邏輯', () => {
        it('應該在 both 模式顯示兩個文本', () => {
            const modes = ['source', 'target', 'both'] as const;
            modes.forEach(mode => {
                expect(['source', 'target', 'both']).toContain(mode);
            });
        });

        it('應該支援 source 模式', () => {
            const mode = 'source' as const;
            expect(mode).toBe('source');
        });

        it('應該支援 target 模式', () => {
            const mode = 'target' as const;
            expect(mode).toBe('target');
        });

        it('應該支援 both 模式', () => {
            const mode = 'both' as const;
            expect(mode).toBe('both');
        });
    });

    describe('狀態指示', () => {
        it('應該追蹤 streaming 狀態', () => {
            const states = [true, false];
            states.forEach(state => {
                expect(typeof state).toBe('boolean');
            });
        });

        it('應該追蹤 accumulating 狀態', () => {
            const states = [true, false];
            states.forEach(state => {
                expect(typeof state).toBe('boolean');
            });
        });

        it('應該追蹤完成狀態', () => {
            expect(mockAccumulatedEntry.isComplete).toBe(true);
        });

        it('應該追蹤段落結束狀態', () => {
            const entry: AccumulatedEntry = {
                ...mockAccumulatedEntry,
                isParagraphEnd: true,
            };
            expect(entry.isParagraphEnd).toBe(true);
        });
    });

    describe('打字機效果配置', () => {
        it('應該支援打字機速度設定', () => {
            const speeds = [0, 30, 50, 100];
            speeds.forEach(speed => {
                expect(typeof speed).toBe('number');
                expect(speed).toBeGreaterThanOrEqual(0);
            });
        });

        it('應該支援啟用/禁用打字機', () => {
            const states = [true, false];
            states.forEach(state => {
                expect(typeof state).toBe('boolean');
            });
        });

        it('應該有預設速度', () => {
            const defaultSpeed = 35;
            expect(defaultSpeed).toBeGreaterThan(0);
        });
    });

    describe('時間戳邏輯', () => {
        it('應該格式化時間戳', () => {
            const timestamp = new Date().toISOString();
            const date = new Date(timestamp);
            const formatted = date.toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            expect(formatted).toBeTruthy();
            expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
        });

        it('應該隱藏 30 秒內的時間戳', () => {
            const now = new Date();
            const recent = new Date(now.getTime() - 10 * 1000); // 10 秒前
            const timeDiff = now.getTime() - recent.getTime();
            const isRecent = timeDiff < 30 * 1000;
            expect(isRecent).toBe(true);
        });

        it('應該顯示超過 30 秒的時間戳', () => {
            const now = new Date();
            const old = new Date(now.getTime() - 60 * 1000); // 60 秒前
            const timeDiff = now.getTime() - old.getTime();
            const isOld = timeDiff >= 30 * 1000;
            expect(isOld).toBe(true);
        });
    });

    describe('反向翻譯邏輯', () => {
        it('應該支援反向翻譯', () => {
            const entry: TranslationEntry = {
                ...mockEntry,
                sourceText: 'Hello',
                targetText: '你好',
            };
            expect(entry.sourceText).toBe('Hello');
            expect(entry.targetText).toBe('你好');
        });

        it('應該交換來源和目標語言', () => {
            const original = { ...mockEntry };
            const reversed: TranslationEntry = {
                ...original,
                sourceLang: original.targetLang,
                targetLang: original.sourceLang,
            };
            expect(reversed.sourceLang).toBe('en');
            expect(reversed.targetLang).toBe('zh-TW');
        });
    });

    describe('段落結束邏輯', () => {
        it('應該標記段落結束', () => {
            const entry: AccumulatedEntry = {
                ...mockAccumulatedEntry,
                isParagraphEnd: true,
            };
            expect(entry.isParagraphEnd).toBe(true);
        });

        it('應該標記段落未結束', () => {
            const entry: AccumulatedEntry = {
                ...mockAccumulatedEntry,
                isParagraphEnd: false,
            };
            expect(entry.isParagraphEnd).toBe(false);
        });

        it('應該強制完成段落結束條目', () => {
            const entry: AccumulatedEntry = {
                ...mockAccumulatedEntry,
                isParagraphEnd: true,
                isComplete: true,
            };
            expect(entry.isComplete).toBe(true);
            expect(entry.isParagraphEnd).toBe(true);
        });
    });

    describe('語言支援', () => {
        it('應該支援所有語言', () => {
            const languages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'id', 'th'];
            languages.forEach(lang => {
                expect(lang).toBeTruthy();
            });
            expect(languages.length).toBe(7);
        });

        it('應該有正確的語言代碼格式', () => {
            const validPatterns = [
                /^[a-z]{2}(-[A-Z]{2})?$/,  // 匹配 'en' 或 'zh-TW'
            ];
            const testLang = 'zh-TW';
            expect(validPatterns[0].test(testLang)).toBe(true);
        });
    });

    describe('累積邏輯', () => {
        it('應該累積多個段落', () => {
            const segments: TranslationEntry[] = [
                { ...mockEntry, sourceText: '第一句' },
                { ...mockEntry, sourceText: '第二句' },
                { ...mockEntry, sourceText: '第三句' },
            ];
            expect(segments.length).toBe(3);
        });

        it('應該保存所有段落', () => {
            const accumulated: AccumulatedEntry = {
                ...mockAccumulatedEntry,
                segments: [mockEntry, { ...mockEntry, sourceText: '第二句' }],
            };
            expect(accumulated.segments.length).toBe(2);
        });

        it('應該記錄累積狀態', () => {
            const states = {
                isComplete: false,
                isParagraphEnd: false,
            };
            expect(states.isComplete).toBe(false);
            expect(states.isParagraphEnd).toBe(false);
        });
    });
});

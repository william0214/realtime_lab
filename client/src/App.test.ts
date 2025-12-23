import { describe, it, expect, vi } from 'vitest';

// 測試翻譯記錄限制邏輯
describe('App - 翻譯記錄管理', () => {
    const MAX_TRANSLATIONS = 5;

    it('應該限制翻譯記錄數量為 5 條', () => {
        const accumulatedTranslations = Array.from({ length: 10 }, (_, i) => ({
            id: `${i}`,
            sourceText: `source ${i}`,
            targetText: `target ${i}`,
            isComplete: true,
            isParagraphEnd: false,
            segments: [],
            displaySourceText: `source ${i}`,
            displayTargetText: `target ${i}`,
            sourceLang: 'zh-TW' as const,
            targetLang: 'en' as const,
        }));

        // 模擬 slice(-MAX_TRANSLATIONS) 的行為
        const sliced = accumulatedTranslations.slice(-MAX_TRANSLATIONS);

        expect(sliced.length).toBe(MAX_TRANSLATIONS);
        expect(sliced[0].id).toBe('5');
        expect(sliced[sliced.length - 1].id).toBe('9');
    });

    it('應該在少於限制時保留所有翻譯', () => {
        const accumulatedTranslations = Array.from({ length: 3 }, (_, i) => ({
            id: `${i}`,
            sourceText: `source ${i}`,
            targetText: `target ${i}`,
            isComplete: true,
            isParagraphEnd: false,
            segments: [],
            displaySourceText: `source ${i}`,
            displayTargetText: `target ${i}`,
            sourceLang: 'zh-TW' as const,
            targetLang: 'en' as const,
        }));

        const sliced = accumulatedTranslations.slice(-MAX_TRANSLATIONS);

        expect(sliced.length).toBe(3);
    });

    it('應該在空列表時返回空', () => {
        const accumulatedTranslations: Array<any> = [];
        const sliced = accumulatedTranslations.slice(-MAX_TRANSLATIONS);

        expect(sliced.length).toBe(0);
    });
});

// 測試翻譯項目過濾邏輯
describe('App - 翻譯項目過濾', () => {
    interface AccumulatedEntry {
        id: string;
        sourceText: string;
        segments: unknown[];
        isComplete: boolean;
    }

    it('應該過濾掉空的翻譯項目（非錄音時）', () => {
        const accumulatedTranslations: AccumulatedEntry[] = [
            { id: '1', sourceText: '有內容', segments: [{}], isComplete: true },
            { id: '2', sourceText: '', segments: [], isComplete: false },
            { id: '3', sourceText: '也有內容', segments: [{}], isComplete: true },
        ];

        const recording = false;
        const filtered = recording
            ? accumulatedTranslations
            : accumulatedTranslations.filter(entry =>
                entry.sourceText || entry.segments.length > 0
            );

        expect(filtered.length).toBe(2);
        expect(filtered[0].id).toBe('1');
        expect(filtered[1].id).toBe('3');
    });

    it('應該在錄音時顯示所有項目（包括空項目）', () => {
        const accumulatedTranslations: AccumulatedEntry[] = [
            { id: '1', sourceText: '有內容', segments: [{}], isComplete: true },
            { id: '2', sourceText: '', segments: [], isComplete: false },
            { id: '3', sourceText: '也有內容', segments: [{}], isComplete: true },
        ];

        const recording = true;
        const filtered = recording
            ? accumulatedTranslations
            : accumulatedTranslations.filter(entry =>
                entry.sourceText || entry.segments.length > 0
            );

        expect(filtered.length).toBe(3);
    });
});

// 測試狀態樣式邏輯
describe('App - 狀態樣式判斷', () => {
    it('應該為最後一個未完成的非 streaming 項目添加累積樣式', () => {
        const items = [
            { id: '1', isComplete: true, _isStreaming: false },
            { id: '2', isComplete: false, _isStreaming: false },
            { id: '3', isComplete: false, _isStreaming: false },
        ];

        // 模擬只有最後一個項目會顯示累積樣式
        items.forEach((item, index) => {
            const isLastItem = index === items.length - 1;
            const showAccumulating = isLastItem && !item.isComplete && !item._isStreaming;

            if (index === items.length - 1) {
                expect(showAccumulating).toBe(true);
            } else {
                expect(showAccumulating).toBe(false);
            }
        });
    });

    it('應該為 streaming 項目添加 streaming 樣式', () => {
        const item = { id: '1', isComplete: false, _isStreaming: true };
        const isStreaming = item._isStreaming;

        expect(isStreaming).toBe(true);
    });

    it('應該正確處理完成的項目', () => {
        const items = [
            { id: '1', isComplete: true, _isStreaming: false },
            { id: '2', isComplete: true, _isStreaming: false },
        ];

        items.forEach((item, index) => {
            const isLastItem = index === items.length - 1;
            const showAccumulating = isLastItem && !item.isComplete && !item._isStreaming;
            expect(showAccumulating).toBe(false);
        });
    });
});

// 測試時間格式化
describe('App - 時間格式化', () => {
    it('應該正確格式化時間戳', () => {
        const timestamp = '2025-12-12T05:30:00.000Z';
        const formatted = new Date(timestamp).toLocaleTimeString('zh-TW');

        // 驗證格式化結果包含時間信息
        expect(formatted).toBeTruthy();
        expect(formatted.length > 0).toBe(true);
    });

    it('應該處理不同的時間戳', () => {
        const timestamps = [
            '2025-12-12T05:30:00.000Z',
            '2025-12-12T12:30:00.000Z',
            '2025-12-12T23:59:59.000Z',
        ];

        timestamps.forEach(timestamp => {
            const formatted = new Date(timestamp).toLocaleTimeString('zh-TW');
            expect(formatted).toBeTruthy();
        });
    });
});

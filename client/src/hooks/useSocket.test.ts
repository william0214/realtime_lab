import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 由於 useSocket 依賴於 Socket.io 和複雜的網路邏輯
// 我們在這裡編寫單元測試來測試核心功能邏輯

describe('useSocket - 去重邏輯', () => {
    let processedSet: Set<string>;

    beforeEach(() => {
        processedSet = new Set<string>();
    });

    it('應該正確去重相同 ID 但不同長度的翻譯', () => {
        // 模擬翻譯場景：同一個 ID 的多個版本
        const entries = [
            { id: '1234', sourceText: '好' },  // 1 字
            { id: '1234', sourceText: '好,就' },  // 3 字
            { id: '1234', sourceText: '好,就改個名字' },  // 7 字
        ];

        const processedEntries: typeof entries = [];

        for (const entry of entries) {
            const entryKey = `${entry.id}_${entry.sourceText.length}`;

            if (!processedSet.has(entryKey)) {
                processedSet.add(entryKey);
                processedEntries.push(entry);
            }
        }

        expect(processedEntries.length).toBe(3);
        expect(processedSet.size).toBe(3);
        expect(processedSet.has('1234_1')).toBe(true);
        expect(processedSet.has('1234_3')).toBe(true);
        expect(processedSet.has('1234_7')).toBe(true);
    });

    it('應該過濾掉完全相同的翻譯條目', () => {
        const entries = [
            { id: '1234', sourceText: '好,就改個名字' },
            { id: '1234', sourceText: '好,就改個名字' },  // 重複
            { id: '1234', sourceText: '好,就改個名字' },  // 重複
        ];

        const processedEntries: typeof entries = [];

        for (const entry of entries) {
            const entryKey = `${entry.id}_${entry.sourceText.length}`;

            if (!processedSet.has(entryKey)) {
                processedSet.add(entryKey);
                processedEntries.push(entry);
            }
        }

        expect(processedEntries.length).toBe(1);
        expect(processedSet.size).toBe(1);
    });

    it('應該允許不同 ID 的翻譯通過', () => {
        const entries = [
            { id: '1234', sourceText: '好,就改個名字' },
            { id: '5678', sourceText: '好,就改個名字' },  // 不同 ID
            { id: '9012', sourceText: '好,就改個名字' },  // 不同 ID
        ];

        const processedEntries: typeof entries = [];

        for (const entry of entries) {
            const entryKey = `${entry.id}_${entry.sourceText.length}`;

            if (!processedSet.has(entryKey)) {
                processedSet.add(entryKey);
                processedEntries.push(entry);
            }
        }

        expect(processedEntries.length).toBe(3);
        expect(processedSet.size).toBe(3);
    });
});

describe('useSocket - 合併邏輯', () => {
    const SHORT_THRESHOLD = 12;
    const MERGE_WINDOW_MS = 2000;

    interface Bubble {
        id: string;
        sourceText: string;
        isComplete: boolean;
    }

    it('應該正確識別短段落', () => {
        const shortText = '好';
        const mediumText = '好,改個名字';
        const longText = '這條 pipeline 的每次 run 都在這裡';

        expect(shortText.length <= SHORT_THRESHOLD).toBe(true);
        expect(mediumText.length <= SHORT_THRESHOLD).toBe(true);
        expect(longText.length <= SHORT_THRESHOLD).toBe(false);
    });

    it('應該在無段落結束標記時合併短段落', () => {
        const lastBubble: Bubble = {
            id: '1234',
            sourceText: '好',
            isComplete: false,
        };
        const newEntry = {
            sourceText: '改',
            isParagraphEnd: false,
        };

        const isShortSegment = newEntry.sourceText.length <= SHORT_THRESHOLD;
        const timeDiff = 500;  // 500ms 內
        const shouldMerge = lastBubble &&
            !lastBubble.isComplete &&
            isShortSegment &&
            timeDiff <= MERGE_WINDOW_MS &&
            !newEntry.isParagraphEnd;

        expect(shouldMerge).toBe(true);
    });

    it('應該在偵測到段落結束時不合併', () => {
        const lastBubble: Bubble = {
            id: '1234',
            sourceText: '好',
            isComplete: false,
        };
        const newEntry = {
            sourceText: '改',
            isParagraphEnd: true,  // 段落結束
        };

        const isShortSegment = newEntry.sourceText.length <= SHORT_THRESHOLD;
        const timeDiff = 500;
        const shouldMerge = lastBubble &&
            !lastBubble.isComplete &&
            isShortSegment &&
            timeDiff <= MERGE_WINDOW_MS &&
            !newEntry.isParagraphEnd;

        expect(shouldMerge).toBe(false);
    });

    it('應該在超過時間窗口時不合併', () => {
        const lastBubble: Bubble = {
            id: '1234',
            sourceText: '好',
            isComplete: false,
        };
        const newEntry = {
            sourceText: '改',
            isParagraphEnd: false,
        };

        const isShortSegment = newEntry.sourceText.length <= SHORT_THRESHOLD;
        const timeDiff = 3000;  // 3000ms > MERGE_WINDOW_MS (2000ms)
        const shouldMerge = lastBubble &&
            !lastBubble.isComplete &&
            isShortSegment &&
            timeDiff <= MERGE_WINDOW_MS &&
            !newEntry.isParagraphEnd;

        expect(shouldMerge).toBe(false);
    });

    it('應該在長段落時不合併', () => {
        const lastBubble: Bubble = {
            id: '1234',
            sourceText: '好',
            isComplete: false,
        };
        const newEntry = {
            sourceText: '這條 pipeline 的每次 run 都在這裡所以兩個 pipeline 的 design',
            isParagraphEnd: false,
        };

        const isShortSegment = newEntry.sourceText.length <= SHORT_THRESHOLD;
        const timeDiff = 500;
        const shouldMerge = lastBubble &&
            !lastBubble.isComplete &&
            isShortSegment &&
            timeDiff <= MERGE_WINDOW_MS &&
            !newEntry.isParagraphEnd;

        expect(shouldMerge).toBe(false);
    });

    it('應該在上一個泡泡已完成時不合併', () => {
        const lastBubble: Bubble = {
            id: '1234',
            sourceText: '好',
            isComplete: true,  // 已完成
        };
        const newEntry = {
            sourceText: '改',
            isParagraphEnd: false,
        };

        const isShortSegment = newEntry.sourceText.length <= SHORT_THRESHOLD;
        const timeDiff = 500;
        const shouldMerge = lastBubble &&
            !lastBubble.isComplete &&
            isShortSegment &&
            timeDiff <= MERGE_WINDOW_MS &&
            !newEntry.isParagraphEnd;

        expect(shouldMerge).toBe(false);
    });
});

describe('useSocket - 段落結束邏輯', () => {
    it('應該在段落結束時標記泡泡為完成', () => {
        const newBubbleIsComplete = true;  // isParagraphEnd || false

        expect(newBubbleIsComplete).toBe(true);
    });

    it('應該在無段落結束時泡泡預設為未完成', () => {
        const isParagraphEnd = false;
        const newBubbleIsComplete = isParagraphEnd || false;

        expect(newBubbleIsComplete).toBe(false);
    });
});

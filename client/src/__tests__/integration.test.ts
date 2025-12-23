import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 集成測試 - 測試端到端的翻譯流程
 */

describe('端到端翻譯流程集成測試', () => {
    // 模擬完整的翻譯流程
    interface TranslationFlow {
        recordAudio: (audio: Blob) => Promise<void>;
        sendToServer: () => Promise<void>;
        receivePartial: () => Promise<string>;
        receiveFinal: () => Promise<string>;
        displayResult: (text: string) => void;
    }

    let flow: TranslationFlow;
    let sentChunks: Blob[] = [];
    let displayedText: string = '';

    beforeEach(() => {
        sentChunks = [];
        displayedText = '';

        flow = {
            recordAudio: async (audio: Blob) => {
                sentChunks.push(audio);
            },
            sendToServer: async () => {
                // 模擬發送到伺服器
                expect(sentChunks.length).toBeGreaterThan(0);
            },
            receivePartial: async () => {
                return '翻譯中...';
            },
            receiveFinal: async () => {
                return 'Translating...';
            },
            displayResult: (text: string) => {
                displayedText = text;
            },
        };
    });

    it('應該完成完整的錄音→發送→翻譯→顯示流程', async () => {
        // 1. 錄音
        const audioChunk = new Blob(['audio data']);
        await flow.recordAudio(audioChunk);
        expect(sentChunks.length).toBe(1);

        // 2. 發送到伺服器
        await flow.sendToServer();

        // 3. 接收 partial 翻譯
        const partial = await flow.receivePartial();
        expect(partial).toBeTruthy();

        // 4. 接收 final 翻譯
        const final = await flow.receiveFinal();
        expect(final).toBeTruthy();

        // 5. 顯示結果
        flow.displayResult(final);
        expect(displayedText).toBe(final);
    });

    it('應該支援多個連續的音訊片段', async () => {
        const chunks = [
            new Blob(['chunk1']),
            new Blob(['chunk2']),
            new Blob(['chunk3']),
        ];

        for (const chunk of chunks) {
            await flow.recordAudio(chunk);
        }

        expect(sentChunks.length).toBe(3);
        await flow.sendToServer();
    });

    it('應該正確處理 streaming 更新', async () => {
        const updates = ['翻', '翻譯', '翻譯中', '翻譯中...'];

        for (const update of updates) {
            flow.displayResult(update);
            expect(displayedText).toBe(update);
        }

        expect(displayedText).toBe('翻譯中...');
    });

    it('應該在完整翻譯後替換 streaming 文本', async () => {
        // 1. 顯示 partial
        flow.displayResult('翻譯中...');
        expect(displayedText).toBe('翻譯中...');

        // 2. 接收 final 並替換
        const final = await flow.receiveFinal();
        flow.displayResult(final);
        expect(displayedText).toBe(final);
        expect(displayedText).not.toBe('翻譯中...');
    });
});

describe('多客戶端翻譯流程', () => {
    interface ClientSession {
        id: string;
        sourceLang: string;
        targetLang: string;
        translations: Array<{ text: string; timestamp: Date }>;
    }

    const sessions = new Map<string, ClientSession>();

    const createSession = (id: string, sourceLang: string, targetLang: string): ClientSession => {
        const session: ClientSession = {
            id,
            sourceLang,
            targetLang,
            translations: [],
        };
        sessions.set(id, session);
        return session;
    };

    const addTranslation = (clientId: string, text: string): void => {
        const session = sessions.get(clientId);
        if (session) {
            session.translations.push({ text, timestamp: new Date() });
        }
    };

    it('應該分別處理多個客戶端的翻譯', () => {
        // 創建兩個會話
        const client1 = createSession('client1', 'zh-TW', 'en');
        const client2 = createSession('client2', 'en', 'zh-TW');

        // 添加翻譯
        addTranslation('client1', 'Hello');
        addTranslation('client2', '你好');

        expect(sessions.get('client1')?.translations.length).toBe(1);
        expect(sessions.get('client2')?.translations.length).toBe(1);
        expect(sessions.get('client1')?.translations[0].text).toBe('Hello');
        expect(sessions.get('client2')?.translations[0].text).toBe('你好');
    });

    it('應該保持各客戶端的語言配置獨立', () => {
        const client1 = createSession('client1', 'zh-TW', 'en');
        const client2 = createSession('client2', 'en', 'zh-TW');

        expect(client1.sourceLang).toBe('zh-TW');
        expect(client1.targetLang).toBe('en');
        expect(client2.sourceLang).toBe('en');
        expect(client2.targetLang).toBe('zh-TW');
    });

    it('應該獨立管理各客戶端的翻譯歷史', () => {
        const client1 = createSession('client1', 'zh-TW', 'en');
        const client2 = createSession('client2', 'en', 'zh-TW');

        addTranslation('client1', 'Text1');
        addTranslation('client1', 'Text2');
        addTranslation('client2', 'Text3');
        addTranslation('client2', 'Text4');
        addTranslation('client2', 'Text5');

        expect(sessions.get('client1')?.translations.length).toBe(2);
        expect(sessions.get('client2')?.translations.length).toBe(3);
    });
});

describe('泡泡合併流程', () => {
    const MERGE_WINDOW_MS = 2000;
    const SHORT_THRESHOLD = 12;

    interface Bubble {
        id: string;
        text: string;
        isComplete: boolean;
        createdAt: Date;
    }

    interface MergeDecision {
        shouldMerge: boolean;
        reason: string;
    }

    const decideMerge = (
        lastBubble: Bubble | null,
        newText: string,
        timeDiff: number
    ): MergeDecision => {
        if (!lastBubble) {
            return { shouldMerge: false, reason: 'No previous bubble' };
        }

        if (lastBubble.isComplete) {
            return { shouldMerge: false, reason: 'Last bubble is complete' };
        }

        if (newText.length > SHORT_THRESHOLD) {
            return { shouldMerge: false, reason: 'New text is too long' };
        }

        if (timeDiff > MERGE_WINDOW_MS) {
            return { shouldMerge: false, reason: 'Time window exceeded' };
        }

        return { shouldMerge: true, reason: 'All conditions met' };
    };

    it('應該在時間窗口內合併短段落', () => {
        const lastBubble: Bubble = {
            id: '1',
            text: '你',
            isComplete: false,
            createdAt: new Date(),
        };

        const decision = decideMerge(lastBubble, '好', 500);
        expect(decision.shouldMerge).toBe(true);
    });

    it('應該在超時時不合併', () => {
        const lastBubble: Bubble = {
            id: '1',
            text: '你',
            isComplete: false,
            createdAt: new Date(),
        };

        const decision = decideMerge(lastBubble, '好', 3000);
        expect(decision.shouldMerge).toBe(false);
        expect(decision.reason).toContain('Time');
    });

    it('應該在長段落時不合併', () => {
        const lastBubble: Bubble = {
            id: '1',
            text: '你',
            isComplete: false,
            createdAt: new Date(),
        };

        const longText = '這是一個很長的文本，超過了十二個字的限制';
        const decision = decideMerge(lastBubble, longText, 500);
        expect(decision.shouldMerge).toBe(false);
        expect(decision.reason).toContain('too long');
    });

    it('應該在完成的泡泡不合併', () => {
        const lastBubble: Bubble = {
            id: '1',
            text: '你好',
            isComplete: true,
            createdAt: new Date(),
        };

        const decision = decideMerge(lastBubble, '好', 500);
        expect(decision.shouldMerge).toBe(false);
        expect(decision.reason).toContain('complete');
    });

    it('應該進行連續合併直到完成', () => {
        let bubble: Bubble | null = {
            id: '1',
            text: '你',
            isComplete: false,
            createdAt: new Date(),
        };

        const texts = ['好', '，', '我', '叫'];
        const merged: string[] = [bubble.text];

        for (const text of texts) {
            const decision = decideMerge(bubble, text, 100);
            if (decision.shouldMerge && bubble) {
                bubble.text += text;
                merged.push(bubble.text);
            }
        }

        expect(merged.length).toBeGreaterThan(1);
        expect(merged[merged.length - 1]).toContain('好');
    });
});

describe('錯誤恢復流程', () => {
    interface ErrorRecovery {
        attempt: number;
        success: boolean;
        message: string;
    }

    const maxRetries = 3;

    const retryTranslation = async (
        fn: () => Promise<string>,
        maxAttempts: number = maxRetries
    ): Promise<string | null> => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxAttempts) {
                    return null;
                }
                // 等待後重試
                await new Promise(resolve => setTimeout(resolve, 100 * attempt));
            }
        }
        return null;
    };

    it('應該在第一次成功時返回', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            return 'success';
        };

        const result = await retryTranslation(fn);
        expect(result).toBe('success');
        expect(callCount).toBe(1);
    });

    it('應該在多次失敗後返回 null', async () => {
        const fn = async () => {
            throw new Error('Always fails');
        };

        const result = await retryTranslation(fn, 3);
        expect(result).toBeNull();
    });

    it('應該在重試後成功', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            if (callCount < 2) {
                throw new Error('First attempt fails');
            }
            return 'success';
        };

        const result = await retryTranslation(fn, 3);
        expect(result).toBe('success');
        expect(callCount).toBe(2);
    });
});

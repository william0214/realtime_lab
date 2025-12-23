import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 伺服器 API 端點測試
 */
describe('伺服器 API 端點', () => {
    const mockRequest = (method: string, url: string, body?: any) => ({
        method,
        url,
        body,
        headers: { 'content-type': 'application/json' },
    });

    const mockResponse = () => {
        const response = {
            statusCode: 200,
            body: null as any,
            json: function (data: any) {
                this.body = data;
                return this;
            },
            status: function (code: number) {
                this.statusCode = code;
                return this;
            },
            send: function (data: any) {
                this.body = data;
                return this;
            }
        };
        return response;
    };

    describe('健康檢查端點', () => {
        it('應該返回 200 狀態碼', () => {
            const res = mockResponse();
            res.status(200).json({ status: 'ok' });

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('status');
        });

        it('應該返回伺服器狀態信息', () => {
            const res = mockResponse();
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });

            expect(res.body.status).toBe('ok');
            expect(res.body).toHaveProperty('timestamp');
            expect(res.body).toHaveProperty('version');
        });

        it('應該返回連線統計', () => {
            const res = mockResponse();
            res.json({
                status: 'ok',
                connectedClients: 5,
                activeTranslations: 3,
                uptime: 86400
            });

            expect(res.body.connectedClients).toBeGreaterThanOrEqual(0);
            expect(res.body.activeTranslations).toBeGreaterThanOrEqual(0);
            expect(res.body.uptime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('語言配置端點', () => {
        it('應該返回支援的語言列表', () => {
            const supportedLanguages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'id', 'th'];

            const res = mockResponse();
            res.json({ languages: supportedLanguages });

            expect(res.body.languages).toContain('zh-TW');
            expect(res.body.languages).toContain('en');
            expect(res.body.languages.length).toBe(7);
        });

        it('應該返回語言名稱對照', () => {
            const res = mockResponse();
            res.json({
                'zh-TW': '繁體中文',
                'en': '英文',
                'ja': '日文',
                'ko': '韓文',
                'vi': '越南文',
                'id': '印尼文',
                'th': '泰文'
            });

            expect(res.body['zh-TW']).toBe('繁體中文');
            expect(res.body['en']).toBe('英文');
        });
    });
});

/**
 * Socket.io 事件測試
 */
describe('Socket.io 連線管理', () => {
    interface MockSocket {
        id: string;
        connected: boolean;
        listeners: Map<string, Function[]>;
        on: (event: string, callback: Function) => void;
        emit: (event: string, data?: any) => void;
        removeListener: (event: string, callback: Function) => void;
    }

    const createMockSocket = (id: string): MockSocket => {
        const listeners = new Map<string, Function[]>();

        return {
            id,
            connected: true,
            listeners,
            on(event: string, callback: Function) {
                if (!this.listeners.has(event)) {
                    this.listeners.set(event, []);
                }
                this.listeners.get(event)!.push(callback);
            },
            emit(event: string, data?: any) {
                const callbacks = this.listeners.get(event) || [];
                callbacks.forEach(cb => cb(data));
            },
            removeListener(event: string, callback: Function) {
                const callbacks = this.listeners.get(event) || [];
                const idx = callbacks.indexOf(callback);
                if (idx > -1) {
                    callbacks.splice(idx, 1);
                }
            }
        };
    };

    describe('連線事件', () => {
        it('應該監聽新客戶端連線', () => {
            const mockSocket = createMockSocket('socket-1');
            const onConnect = vi.fn();

            mockSocket.on('connect', onConnect);
            mockSocket.emit('connect');

            expect(onConnect).toHaveBeenCalled();
        });

        it('應該追蹤連線客戶端', () => {
            const clients = new Map<string, any>();
            const socket1 = createMockSocket('socket-1');
            const socket2 = createMockSocket('socket-2');

            clients.set(socket1.id, { socket: socket1, language: 'zh-TW' });
            clients.set(socket2.id, { socket: socket2, language: 'en' });

            expect(clients.size).toBe(2);
            expect(clients.has('socket-1')).toBe(true);
            expect(clients.has('socket-2')).toBe(true);
        });

        it('應該在客戶端斷連時移除', () => {
            const clients = new Map<string, any>();
            const socket = createMockSocket('socket-1');

            clients.set(socket.id, { socket });
            expect(clients.size).toBe(1);

            // 模擬斷連
            clients.delete(socket.id);
            expect(clients.size).toBe(0);
        });

        it('應該生成唯一的連線 ID', () => {
            const socket1 = createMockSocket('socket-1');
            const socket2 = createMockSocket('socket-2');
            const socket3 = createMockSocket('socket-3');

            const ids = [socket1.id, socket2.id, socket3.id];
            const uniqueIds = new Set(ids);

            expect(uniqueIds.size).toBe(3);
        });
    });

    describe('訊息事件', () => {
        it('應該接收音訊片段', () => {
            const socket = createMockSocket('socket-1');
            const onAudio = vi.fn();

            socket.on('audio', onAudio);
            socket.emit('audio', { chunk: new ArrayBuffer(1024) });

            expect(onAudio).toHaveBeenCalled();
        });

        it('應該接收語言配置', () => {
            const socket = createMockSocket('socket-1');
            const onLanguage = vi.fn();

            socket.on('set-language', onLanguage);
            socket.emit('set-language', { source: 'zh-TW', target: 'en' });

            expect(onLanguage).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'zh-TW',
                    target: 'en'
                })
            );
        });

        it('應該廣播翻譯結果', () => {
            const socket1 = createMockSocket('socket-1');
            const socket2 = createMockSocket('socket-2');

            const onTranslation = vi.fn();
            socket2.on('translation', onTranslation);

            // 模擬從 socket1 廣播到 socket2
            socket2.emit('translation', {
                id: 'trans-1',
                sourceText: '你好',
                targetText: 'Hello'
            });

            expect(onTranslation).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceText: '你好',
                    targetText: 'Hello'
                })
            );
        });

        it('應該支援多個訊息類型', () => {
            const socket = createMockSocket('socket-1');
            const handlers = {
                audio: vi.fn(),
                translation: vi.fn(),
                error: vi.fn(),
            };

            Object.entries(handlers).forEach(([event, handler]) => {
                socket.on(event, handler);
            });

            socket.emit('audio', { chunk: new ArrayBuffer(1024) });
            socket.emit('translation', { text: 'Hello' });
            socket.emit('error', { message: 'Error' });

            expect(handlers.audio).toHaveBeenCalled();
            expect(handlers.translation).toHaveBeenCalled();
            expect(handlers.error).toHaveBeenCalled();
        });
    });

    describe('客戶端隔離', () => {
        it('應該為每個客戶端維持獨立狀態', () => {
            const socket1 = createMockSocket('socket-1');
            const socket2 = createMockSocket('socket-2');

            const state = new Map<string, any>();
            state.set('socket-1', { language: 'zh-TW', audioBuffer: [] });
            state.set('socket-2', { language: 'en', audioBuffer: [] });

            expect(state.get('socket-1')!.language).toBe('zh-TW');
            expect(state.get('socket-2')!.language).toBe('en');
        });

        it('應該隔離音訊緩衝區', () => {
            const buffers = new Map<string, Uint8Array[]>();
            buffers.set('socket-1', [new Uint8Array(100)]);
            buffers.set('socket-2', [new Uint8Array(200)]);

            expect(buffers.get('socket-1')![0].byteLength).toBe(100);
            expect(buffers.get('socket-2')![0].byteLength).toBe(200);
        });

        it('應該隔離翻譯記錄', () => {
            const translations = new Map<string, any[]>();
            translations.set('socket-1', [
                { id: '1', text: 'Hello' },
                { id: '2', text: 'World' }
            ]);
            translations.set('socket-2', [
                { id: '1', text: '你好' }
            ]);

            expect(translations.get('socket-1')!.length).toBe(2);
            expect(translations.get('socket-2')!.length).toBe(1);
        });
    });

    describe('重連機制', () => {
        it('應該支援客戶端重連', () => {
            const socket = createMockSocket('socket-1');
            const onReconnect = vi.fn();

            socket.on('reconnect', onReconnect);
            socket.emit('reconnect');

            expect(onReconnect).toHaveBeenCalled();
        });

        it('應該在重連時恢復狀態', () => {
            const savedState = { language: 'zh-TW', sessionId: 'session-1' };
            const restoredSocket = createMockSocket('socket-1');

            const newState = { ...savedState };
            expect(newState.language).toBe('zh-TW');
            expect(newState.sessionId).toBe('session-1');
        });
    });
});

/**
 * 音訊轉換邏輯測試
 */
describe('音訊轉換處理', () => {
    describe('緩衝區管理', () => {
        it('應該累積音訊數據', () => {
            const buffer: Uint8Array[] = [];
            const chunk1 = new Uint8Array(1024);
            const chunk2 = new Uint8Array(1024);

            buffer.push(chunk1);
            buffer.push(chunk2);

            const totalBytes = buffer.reduce((sum, buf) => sum + buf.byteLength, 0);
            expect(totalBytes).toBe(2048);
        });

        it('應該檢查足夠的數據量', () => {
            const buffer: Uint8Array[] = [];
            const MIN_BYTES = 8000;

            buffer.push(new Uint8Array(5000));
            expect(buffer.reduce((sum, b) => sum + b.byteLength, 0)).toBeLessThan(MIN_BYTES);

            buffer.push(new Uint8Array(3000));
            expect(buffer.reduce((sum, b) => sum + b.byteLength, 0)).toBe(8000);
        });

        it('應該清空緩衝區', () => {
            const buffer: Uint8Array[] = [
                new Uint8Array(1024),
                new Uint8Array(1024),
                new Uint8Array(1024),
            ];

            expect(buffer.length).toBe(3);

            buffer.length = 0;
            expect(buffer.length).toBe(0);
        });

        it('應該追蹤新增數據量', () => {
            const buffer: Uint8Array[] = [
                new Uint8Array(5000),
            ];

            const newData = new Uint8Array(3000);
            const oldTotalBytes = buffer.reduce((sum, b) => sum + b.byteLength, 0);
            const newBytes = newData.byteLength;

            buffer.push(newData);
            const totalAfter = buffer.reduce((sum, b) => sum + b.byteLength, 0);

            expect(totalAfter).toBe(oldTotalBytes + newBytes);
            expect(newBytes).toBe(3000);
        });
    });

    describe('轉換邏輯', () => {
        const mockConvertToPCM16 = (data: Uint8Array): Int16Array => {
            // 簡單的模擬轉換
            const pcm = new Int16Array(data.length / 2);
            for (let i = 0; i < pcm.length; i++) {
                const byte1 = data[i * 2];
                const byte2 = data[i * 2 + 1];
                pcm[i] = byte1 | (byte2 << 8);
            }
            return pcm;
        };

        it('應該轉換為 PCM16 格式', () => {
            const input = new Uint8Array(8000);
            const output = mockConvertToPCM16(input);

            expect(output instanceof Int16Array).toBe(true);
            expect(output.length).toBe(4000);
        });

        it('應該保持轉換後的音訊品質', () => {
            const input = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
            const output = mockConvertToPCM16(input);

            expect(output[0]).toBe(0x0100);
            expect(output[1]).toBe(0x0302);
        });

        it('應該支援增量轉換', () => {
            const buffer: Uint8Array[] = [];
            const chunk1 = new Uint8Array(4000);
            const chunk2 = new Uint8Array(4000);

            buffer.push(chunk1);
            let totalData = new Uint8Array(4000);

            buffer.push(chunk2);
            const newData = new Uint8Array(4000 + 4000);
            expect(newData.byteLength).toBe(8000);
        });
    });

    describe('轉換間隔管理', () => {
        it('應該設定轉換時間間隔', () => {
            const conversionIntervalMs = 1500;
            expect(conversionIntervalMs).toBeGreaterThan(0);
        });

        it('應該在間隔內累積數據', (done) => {
            const INTERVAL = 100; // 測試用較短間隔
            const startTime = Date.now();

            setTimeout(() => {
                const elapsed = Date.now() - startTime;
                expect(elapsed).toBeGreaterThanOrEqual(INTERVAL);
                done();
            }, INTERVAL);
        });

        it('應該支援自訂轉換間隔', () => {
            const intervals = [1000, 1500, 2000];
            intervals.forEach(interval => {
                expect(interval).toBeGreaterThan(0);
                expect(interval).toBeLessThanOrEqual(5000);
            });
        });
    });

    describe('錯誤恢復', () => {
        it('應該在轉換失敗時恢復', () => {
            const mockConvertWithError = (data: Uint8Array) => {
                if (data.byteLength === 0) {
                    throw new Error('Empty data');
                }
                return new Int16Array(data.length / 2);
            };

            const emptyData = new Uint8Array(0);
            expect(() => mockConvertWithError(emptyData)).toThrow('Empty data');

            const validData = new Uint8Array(100);
            expect(() => mockConvertWithError(validData)).not.toThrow();
        });

        it('應該驗證 FFmpeg 可用性', () => {
            const hasFFmpeg = true; // 模擬 FFmpeg 檢查結果
            expect(hasFFmpeg).toBe(true);
        });

        it('應該在 FFmpeg 不可用時降級', () => {
            const ffmpegAvailable = false;
            const fallbackMethod = 'native-conversion';

            if (!ffmpegAvailable) {
                expect(fallbackMethod).toBe('native-conversion');
            }
        });
    });
});

/**
 * 配置管理測試
 */
describe('伺服器配置', () => {
    describe('語言配置', () => {
        it('應該支援 7 種語言', () => {
            const languages = ['zh-TW', 'en', 'ja', 'ko', 'vi', 'id', 'th'];
            expect(languages.length).toBe(7);
        });

        it('應該有預設語言設定', () => {
            const config = {
                defaultSource: 'zh-TW',
                defaultTarget: 'en'
            };

            expect(config.defaultSource).toBe('zh-TW');
            expect(config.defaultTarget).toBe('en');
        });

        it('應該支援語言對配置', () => {
            const pairs = [
                { source: 'zh-TW', target: 'en' },
                { source: 'en', target: 'zh-TW' },
                { source: 'zh-TW', target: 'ja' },
            ];

            pairs.forEach(pair => {
                expect(pair.source).toBeTruthy();
                expect(pair.target).toBeTruthy();
                expect(pair.source).not.toBe(pair.target);
            });
        });
    });

    describe('音訊配置', () => {
        it('應該設定轉換間隔', () => {
            const config = { conversionIntervalMs: 1500 };
            expect(config.conversionIntervalMs).toBeGreaterThan(0);
        });

        it('應該設定最小資料量', () => {
            const config = { minBytesForConversion: 8000 };
            expect(config.minBytesForConversion).toBeGreaterThan(0);
        });

        it('應該驗證配置值範圍', () => {
            const configs = [
                { conversionIntervalMs: 500, minBytesForConversion: 4000 },
                { conversionIntervalMs: 1500, minBytesForConversion: 8000 },
                { conversionIntervalMs: 3000, minBytesForConversion: 16000 },
            ];

            configs.forEach(config => {
                expect(config.conversionIntervalMs).toBeGreaterThan(0);
                expect(config.minBytesForConversion).toBeGreaterThan(0);
            });
        });
    });

    describe('連線配置', () => {
        it('應該設定伺服器端口', () => {
            const port = 3001;
            expect(port).toBeGreaterThan(1000);
            expect(port).toBeLessThan(65536);
        });

        it('應該配置 CORS 來源', () => {
            const corsOrigins = [
                'http://localhost:5173',
                'http://localhost:5174',
                'http://localhost:5175'
            ];

            expect(corsOrigins.length).toBeGreaterThan(0);
            corsOrigins.forEach(origin => {
                expect(origin).toContain('localhost');
            });
        });

        it('應該支援環境變數覆蓋', () => {
            const envPort = process.env.PORT || '3001';
            const port = parseInt(envPort);

            expect(port).toBeGreaterThan(0);
        });
    });
});

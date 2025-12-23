import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// 語言代碼
export type LangCode = 'zh-TW' | 'en' | 'vi' | 'id' | 'th' | 'ja' | 'ko';

// 訊息類型定義
export interface Message {
    type: 'system' | 'user' | 'ai';
    content: string;
    senderId?: string;
    timestamp: string;
}

// 翻譯條目
export interface TranslationEntry {
    id: string;
    sourceText: string;
    targetText: string;
    sourceLang: LangCode;
    targetLang: LangCode;
    isReverse?: boolean;  // 是否為反向翻譯（病人說話）
    timestamp: string;
    isParagraphEnd?: boolean; // 是否為段落結束（停頓偵測）
}

// 累積泡泡條目（用於前端合併顯示）
export interface AccumulatedEntry {
    id: string;  // 群組 ID（使用第一個翻譯的 ID）
    segments: TranslationEntry[];  // 包含的翻譯段落
    sourceText: string;  // 合併後的原文
    targetText: string;  // 合併後的譯文
    displaySourceText: string;  // 打字機效果顯示的原文
    displayTargetText: string;  // 打字機效果顯示的譯文
    sourceLang: LangCode;
    targetLang: LangCode;
    isReverse?: boolean;
    timestamp: string;
    isComplete: boolean;  // 是否已完成（偵測到停頓）
    isParagraphEnd?: boolean;  // 是否在段落結束時完成
}

// Socket 連線狀態
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseSocketReturn {
    socket: Socket | null;
    status: ConnectionStatus;
    messages: Message[];
    translations: TranslationEntry[];
    accumulatedTranslations: AccumulatedEntry[];  // 累積型翻譯（合併顯示用）
    streamingTranslation: TranslationEntry | null;
    sendMessage: (content: string) => void;
    sendAudioBlob: (blob: Blob) => Promise<void>;
    sendAudioChunk: (blob: Blob) => Promise<void>;
    updateConfig: (sourceLang: LangCode, targetLang: LangCode) => void;
    commitAudio: () => void;
    startAudioRecording: () => void;
    stopAudioRecording: () => void;
    clearMessages: () => void;
    clearTranslations: (keepLast?: number) => void;
}

const SOCKET_URL = 'http://localhost:3001';

// 短/長段落合併的閾值
const SHORT_THRESHOLD = 12;  // 短文字閾值（字元數）
const MERGE_WINDOW_MS = 2000;  // 合併時間窗口（毫秒）
const TYPEWRITER_SPEED_MS = 40;  // 打字機效果每個字的間隔（毫秒）

export function useSocket(): UseSocketReturn {
    const [status, setStatus] = useState<ConnectionStatus>('connecting');
    const [messages, setMessages] = useState<Message[]>([]);
    const [translations, setTranslations] = useState<TranslationEntry[]>([]);
    const [accumulatedTranslations, setAccumulatedTranslations] = useState<AccumulatedEntry[]>([]);
    const [streamingTranslation, setStreamingTranslation] = useState<TranslationEntry | null>(null);
    const socketRef = useRef<Socket | null>(null);

    // 追蹤錄音狀態（用於 stopAudioRecording 時標記最後泡泡為完成）
    const isRecordingRef = useRef<boolean>(false);

    // 追蹤已處理的 translate_final entry ID（用於防止 React StrictMode 雙重執行）
    const processedTranslateFinalRef = useRef<Set<string>>(new Set());

    // 打字機效果計時器 Map<bubbleId, { source?: Timer, target?: Timer }>
    const typewriterTimersRef = useRef<Map<string, { source?: ReturnType<typeof setInterval>; target?: ReturnType<typeof setInterval> }>>(new Map());

    // 清除特定泡泡的打字機計時器
    const clearTypewriterTimer = useCallback((bubbleId: string, type?: 'source' | 'target') => {
        const timers = typewriterTimersRef.current.get(bubbleId);
        if (timers) {
            if (!type || type === 'source') {
                if (timers.source) {
                    clearInterval(timers.source);
                    timers.source = undefined;
                }
            }
            if (!type || type === 'target') {
                if (timers.target) {
                    clearInterval(timers.target);
                    timers.target = undefined;
                }
            }
            if (!timers.source && !timers.target) {
                typewriterTimersRef.current.delete(bubbleId);
            }
        }
    }, []);

    // 啟動打字機效果
    const startTypewriterEffect = useCallback((bubbleId: string, fullSourceText: string, fullTargetText: string) => {
        // 清除舊的計時器（如果有）
        clearTypewriterTimer(bubbleId);

        let sourceIndex = 0;
        let targetIndex = 0;
        const timers: { source?: ReturnType<typeof setInterval>; target?: ReturnType<typeof setInterval> } = {};

        // 原文打字機效果
        if (fullSourceText) {
            timers.source = setInterval(() => {
                sourceIndex++;
                const displayText = fullSourceText.slice(0, sourceIndex);

                setAccumulatedTranslations(prev => {
                    const idx = prev.findIndex(b => b.id === bubbleId);
                    if (idx === -1) return prev;

                    const updated = [...prev];
                    updated[idx] = {
                        ...updated[idx],
                        displaySourceText: displayText,
                    };
                    return updated;
                });

                // 完成後清除計時器
                if (sourceIndex >= fullSourceText.length) {
                    clearTypewriterTimer(bubbleId, 'source');
                }
            }, TYPEWRITER_SPEED_MS);
        }

        // 譯文打字機效果（稍微延遲開始，讓原文先顯示一點）
        if (fullTargetText) {
            timers.target = setInterval(() => {
                targetIndex++;
                const displayText = fullTargetText.slice(0, targetIndex);

                setAccumulatedTranslations(prev => {
                    const idx = prev.findIndex(b => b.id === bubbleId);
                    if (idx === -1) return prev;

                    const updated = [...prev];
                    updated[idx] = {
                        ...updated[idx],
                        displayTargetText: displayText,
                    };
                    return updated;
                });

                // 完成後清除計時器
                if (targetIndex >= fullTargetText.length) {
                    clearTypewriterTimer(bubbleId, 'target');
                }
            }, TYPEWRITER_SPEED_MS);
        }

        typewriterTimersRef.current.set(bubbleId, timers);
    }, [clearTypewriterTimer]);

    useEffect(() => {
        // 建立 Socket 連線
        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            autoConnect: true,
        });

        socketRef.current = socket;

        // 連線成功
        socket.on('connect', () => {
            console.log('✅ Connected to server:', socket.id);
            setStatus('connected');
        });

        // 連線斷開
        socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected:', reason);
            setStatus('disconnected');
        });

        // 連線錯誤
        socket.on('connect_error', (error) => {
            console.error('🚨 Connection error:', error);
            setStatus('error');
        });

        // 接收訊息
        socket.on('message', (message: Message) => {
            console.log('📨 Received message:', message);
            setMessages((prev) => [...prev, message]);
        });

        // 接收翻譯 partial（正在翻譯中）
        socket.on('translate_partial', (entry: TranslationEntry) => {
            console.log(
                '🌐 Received translate_partial:',
                entry.id,
                'source:', JSON.stringify(entry.sourceText),
                'target:', JSON.stringify(entry.targetText)
            );
            setStreamingTranslation(entry);
        });

        // 接收翻譯 final（翻譯完成）
        socket.on('translate_final', (entry: TranslationEntry) => {
            console.log(
                '🌐 Received translate_final:',
                entry.id,
                'source:', JSON.stringify(entry.sourceText),
                'target:', JSON.stringify(entry.targetText),
                'isParagraphEnd:', entry.isParagraphEnd
            );

            // 防止重複處理：使用 ID + sourceText 長度的組合作為唯一鍵
            // （同一個 ID 可能有多個版本，隨著翻譯內容增加而更新）
            const entryKey = `${entry.id}_${entry.sourceText.length}`;
            if (processedTranslateFinalRef.current.has(entryKey)) {
                console.log('⚠️ translate_final already processed for:', entryKey);
                return;
            }
            processedTranslateFinalRef.current.add(entryKey);

            // 過濾空的翻譯條目
            if (!entry.sourceText?.trim() && !entry.targetText?.trim()) {
                console.log('⚠️ Empty translation entry, skipping');
                return;
            }

            // 添加到 translations 列表
            setTranslations((prev) => [...prev, entry]);
            setStreamingTranslation(null);

            // 短/長段落合併邏輯
            const entryTime = new Date(entry.timestamp).getTime();
            const isShortSegment = entry.sourceText.length <= SHORT_THRESHOLD;

            // 用於追蹤需要啟動打字機效果的泡泡
            let bubbleIdForTypewriter: string | null = null;
            let fullSourceForTypewriter = '';
            let fullTargetForTypewriter = '';

            setAccumulatedTranslations((prev) => {
                // 取得最後一個未完成的泡泡
                const lastBubble = prev.length > 0 ? prev[prev.length - 1] : null;
                const lastBubbleTime = lastBubble ? new Date(lastBubble.timestamp).getTime() : entryTime;
                const timeDiff = lastBubble ? entryTime - lastBubbleTime : 0;

                const shouldMerge = lastBubble && !lastBubble.isComplete && isShortSegment && timeDiff <= MERGE_WINDOW_MS;

                console.log('📦 MERGE CHECK:', {
                    sourceLength: entry.sourceText.length,
                    isShortSegment,
                    timeDiff,
                    lastBubbleComplete: lastBubble?.isComplete || false,
                    shouldMerge,
                    isParagraphEnd: entry.isParagraphEnd,
                });

                // 如果偵測到段落結束（停頓），強制標記上一個泡泡為完成
                if (entry.isParagraphEnd && lastBubble && !lastBubble.isComplete) {
                    console.log('🔇 Paragraph end detected - forcing last bubble to complete:', lastBubble.id);
                }

                // 判斷是否要合併到上一個泡泡
                // 條件：有上一個泡泡 && 上一個未完成 && 當前是短段落 && 時間差在窗口內 && 沒有段落結束
                if (shouldMerge && !entry.isParagraphEnd) {
                    // 合併到上一個泡泡
                    const updated = [...prev];
                    const newSegments = [...lastBubble.segments, entry];
                    const combinedSourceText = newSegments.map(s => s.sourceText).join(' ');
                    const combinedTargetText = newSegments.map(s => s.targetText).join(' ');

                    console.log('📦 MERGING into last bubble:', {
                        bubbleId: lastBubble.id,
                        segmentCount: newSegments.length,
                        combinedSource: combinedSourceText.substring(0, 50),
                    });

                    // 記錄需要更新打字機效果的泡泡
                    bubbleIdForTypewriter = lastBubble.id;
                    fullSourceForTypewriter = combinedSourceText;
                    fullTargetForTypewriter = combinedTargetText;

                    updated[prev.length - 1] = {
                        ...lastBubble,
                        segments: newSegments,
                        sourceText: combinedSourceText,
                        targetText: combinedTargetText,
                        // displaySourceText 和 displayTargetText 會由打字機效果更新
                        // 保持 isComplete: false，讓下一個短段落可以繼續合併
                    };

                    return updated;
                } else {
                    // 創建新泡泡
                    // 將所有之前未完成的泡泡標記為完成
                    const updated = [...prev];
                    for (let i = 0; i < updated.length; i++) {
                        if (!updated[i].isComplete) {
                            console.log('📦 Marking bubble as complete:', updated[i].id);
                            // 清除該泡泡的打字機計時器
                            clearTypewriterTimer(updated[i].id);
                            // 標記為完成並立即顯示完整文字
                            updated[i] = {
                                ...updated[i],
                                isComplete: true,
                                isParagraphEnd: entry.isParagraphEnd,  // 記錄段落結束信息
                                displaySourceText: updated[i].sourceText,
                                displayTargetText: updated[i].targetText,
                            };
                        }
                    }

                    // 記錄新泡泡需要啟動打字機效果
                    bubbleIdForTypewriter = entry.id;
                    fullSourceForTypewriter = entry.sourceText;
                    fullTargetForTypewriter = entry.targetText;

                    // 創建新泡泡
                    const newBubble: AccumulatedEntry = {
                        id: entry.id,
                        segments: [entry],
                        sourceText: entry.sourceText,
                        targetText: entry.targetText,
                        displaySourceText: '',  // 打字機效果從空開始
                        displayTargetText: '',  // 打字機效果從空開始
                        sourceLang: entry.sourceLang,
                        targetLang: entry.targetLang,
                        isReverse: entry.isReverse,
                        timestamp: entry.timestamp,
                        isComplete: entry.isParagraphEnd || false,  // 如果偵測到段落結束，新泡泡直接標記為完成
                        isParagraphEnd: entry.isParagraphEnd,  // 記錄段落結束信息
                    };

                    console.log('📦 Created new bubble:', entry.id, { isParagraphEnd: entry.isParagraphEnd, isComplete: entry.isParagraphEnd || false });
                    return [...updated, newBubble];
                }
            });

            // 在 state 更新後啟動打字機效果
            if (bubbleIdForTypewriter) {
                // 使用 setTimeout 確保 state 已更新
                setTimeout(() => {
                    startTypewriterEffect(bubbleIdForTypewriter!, fullSourceForTypewriter, fullTargetForTypewriter);
                }, 0);
            }
        });

        // 接收翻譯結果（向後相容，如果沒有 partial/final 流程）
        socket.on('translation', (entry: TranslationEntry) => {
            console.log('🌐 Received translation:', entry);
            // 只在沒有使用 partial/final 流程時才處理
            // 現在 translate_final 會同時觸發 translation，所以這裡不重複處理
        });

        // 清理函數
        return () => {
            // 清除所有打字機計時器
            typewriterTimersRef.current.forEach((timers) => {
                if (timers.source) clearInterval(timers.source);
                if (timers.target) clearInterval(timers.target);
            });
            typewriterTimersRef.current.clear();

            socket.disconnect();
            socketRef.current = null;
        };
    }, [startTypewriterEffect]);

    // 發送訊息
    const sendMessage = useCallback((content: string) => {
        if (socketRef.current && content.trim()) {
            socketRef.current.emit('sendMessage', { content: content.trim() });
        }
    }, []);

    // 發送音訊 Blob (完整錄音)
    const sendAudioBlob = useCallback(async (blob: Blob) => {
        if (!socketRef.current) {
            console.error('🚨 Socket not connected');
            return;
        }

        try {
            // 將 Blob 轉換為 ArrayBuffer
            const arrayBuffer = await blob.arrayBuffer();
            console.log(`🎤 Sending audio: ${arrayBuffer.byteLength} bytes`);

            // 發送音訊資料到後端
            socketRef.current.emit('audio:chunk', arrayBuffer);

            // 顯示使用者發送了語音訊息
            setMessages((prev) => [...prev, {
                type: 'user',
                content: '🎤 [語音訊息]',
                timestamp: new Date().toISOString(),
            }]);
        } catch (error) {
            console.error('🚨 Failed to send audio:', error);
        }
    }, []);

    // 發送音訊 chunk (連續錄音用)
    const sendAudioChunk = useCallback(async (blob: Blob) => {
        if (!socketRef.current) {
            console.error('🚨 Socket not connected');
            return;
        }

        try {
            const arrayBuffer = await blob.arrayBuffer();
            console.log(`🎤 Sending audio chunk: ${arrayBuffer.byteLength} bytes`);
            socketRef.current.emit('audio:chunk', arrayBuffer);
        } catch (error) {
            console.error('🚨 Failed to send audio chunk:', error);
        }
    }, []);

    // 更新語言設定
    const updateConfig = useCallback((sourceLang: LangCode, targetLang: LangCode) => {
        if (socketRef.current) {
            console.log(`🌐 Updating config: ${sourceLang} -> ${targetLang}`);
            socketRef.current.emit('config:update', { sourceLang, targetLang });
        }
    }, []);

    // 提交音訊並請求回應
    const commitAudio = useCallback(() => {
        if (socketRef.current) {
            console.log('📤 Committing audio...');
            socketRef.current.emit('audio:commit');
        }
    }, []);

    // 開始錄音 - 通知 server 重置 buffer
    const startAudioRecording = useCallback(() => {
        if (socketRef.current) {
            console.log('🎤 Starting audio recording...');
            socketRef.current.emit('audio:start');
            isRecordingRef.current = true;
        }
    }, []);

    // 停止錄音 - 標記最後一個泡泡為完成並立即顯示完整文字
    const stopAudioRecording = useCallback(() => {
        console.log('🛑 Stopping audio recording...');
        isRecordingRef.current = false;

        // 清除所有打字機計時器，並立即顯示完整文字
        typewriterTimersRef.current.forEach((timers) => {
            if (timers.source) clearInterval(timers.source);
            if (timers.target) clearInterval(timers.target);
        });
        typewriterTimersRef.current.clear();

        // 標記最後一個泡泡為完成，並確保顯示完整文字
        setAccumulatedTranslations((prev) => {
            if (prev.length === 0) return prev;

            // 更新所有泡泡：確保 displayText 等於完整文字
            return prev.map((bubble, idx) => {
                const isLast = idx === prev.length - 1;
                const shouldMarkComplete = isLast && !bubble.isComplete && bubble.sourceText;

                return {
                    ...bubble,
                    displaySourceText: bubble.sourceText,  // 立即顯示完整原文
                    displayTargetText: bubble.targetText,  // 立即顯示完整譯文
                    isComplete: shouldMarkComplete ? true : bubble.isComplete,
                };
            });
        });
    }, []);

    // 清除訊息
    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    // 清除翻譯（可選保留最新的 N 條）
    const clearTranslations = useCallback((keepLast: number = 0) => {
        if (keepLast > 0) {
            setTranslations(prev => prev.slice(-keepLast));
            setAccumulatedTranslations(prev => prev.slice(-keepLast));
            // 當保留部分翻譯時，也要清空已處理的 entry 集合
            // 但這樣會導致保留的翻譯重複出現，所以改為只移除被刪除的 entry
            // 實際上，直接清空整個集合是安全的，因為 ID + length 組合是唯一的
            processedTranslateFinalRef.current.clear();
        } else {
            // 完全清空時重設所有状態
            setTranslations([]);
            setAccumulatedTranslations([]);
            processedTranslateFinalRef.current.clear();
        }
        setStreamingTranslation(null);
        isRecordingRef.current = false;  // 重設錄音狀態
    }, []);

    return {
        socket: socketRef.current,
        status,
        messages,
        translations,
        accumulatedTranslations,
        streamingTranslation,
        sendMessage,
        sendAudioBlob,
        sendAudioChunk,
        updateConfig,
        commitAudio,
        startAudioRecording,
        stopAudioRecording,
        clearMessages,
        clearTranslations,
    };
}

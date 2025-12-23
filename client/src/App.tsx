import { useState, useEffect, useRef, useMemo } from 'react';
import { useSocket, ConnectionStatus, LangCode, AccumulatedEntry } from './hooks/useSocket';
import { useContinuousRecorder } from './hooks/useContinuousRecorder';
import './App.css';

// 語言選項
const LANGUAGES: { code: LangCode; label: string }[] = [
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'id', label: 'Bahasa Indonesia' },
    { code: 'th', label: 'ภาษาไทย' },
];

// 擴展型別，用於前端判斷是否為 streaming 狀態
type DisplayEntry = AccumulatedEntry & { _isStreaming?: boolean };

function App() {
    const {
        status,
        accumulatedTranslations,
        streamingTranslation,
        sendAudioChunk,
        updateConfig,
        commitAudio,
        startAudioRecording,
        stopAudioRecording,
        clearTranslations,
    } = useSocket();

    const [sourceLang, setSourceLang] = useState<LangCode>('zh-TW');
    const [targetLang, setTargetLang] = useState<LangCode>('en');

    // 自動捲動的 ref
    const sourceBottomRef = useRef<HTMLDivElement | null>(null);
    const targetBottomRef = useRef<HTMLDivElement | null>(null);

    // 連續錄音 hook
    const {
        recording,
        start: startRecording,
        stop: stopRecording,
        error: recorderError,
    } = useContinuousRecorder({
        timeslice: 300,
        onChunk: (blob) => {
            sendAudioChunk(blob);
        },
        onStop: () => {
            // 停止錄音時提交音訊
            commitAudio();
        },
    });

    // 開始錄音的處理函數
    const handleStartRecording = () => {
        startAudioRecording(); // 通知 server 重置 buffer 並創建空泡泡
        startRecording();      // 開始瀏覽器錄音
    };

    // 停止錄音的處理函數
    const handleStopRecording = () => {
        stopRecording();       // 停止瀏覽器錄音
        stopAudioRecording();  // 清理空泡泡並重置狀態
    };

    // 限制翻譯數量（最多顯示 5 條泡泡，超過就清除舊的）
    const MAX_TRANSLATIONS = 5;

    // 自動清除舊訊息（超過限制時保留最新的）
    // 使用 clearTranslations.current 而不是函數本身作為依賴項
    useEffect(() => {
        if (accumulatedTranslations.length > MAX_TRANSLATIONS) {
            clearTranslations(MAX_TRANSLATIONS);
        }
    }, [accumulatedTranslations.length]);  // 移除 clearTranslations 依賴項以避免無限循環

    // 語言變更時通知後端
    useEffect(() => {
        if (status === 'connected') {
            updateConfig(sourceLang, targetLang);
        }
    }, [sourceLang, targetLang, status, updateConfig]);

    // 產生統一的 items 陣列（使用累積型翻譯）
    const items: DisplayEntry[] = useMemo(() => {
        // 錄音時：顯示所有泡泡（包括空泡泡）
        // 不錄音時：過濾掉空泡泡
        const filteredTranslations = recording
            ? accumulatedTranslations  // 錄音中：顯示全部（包含空泡泡）
            : accumulatedTranslations.filter((entry) => {
                // 只保留有內容的泡泡
                return entry.sourceText || entry.segments.length > 0;
            });

        // 將 streaming 翻譯轉換為顯示條目
        if (streamingTranslation) {
            // 建立一個臨時的 streaming 條目
            const streamingEntry: DisplayEntry = {
                id: streamingTranslation.id + '-streaming',
                segments: [streamingTranslation],
                sourceText: streamingTranslation.sourceText,
                targetText: streamingTranslation.targetText,
                displaySourceText: streamingTranslation.sourceText,  // streaming 直接顯示完整文字
                displayTargetText: streamingTranslation.targetText,  // streaming 直接顯示完整文字
                sourceLang: streamingTranslation.sourceLang,
                targetLang: streamingTranslation.targetLang,
                isReverse: streamingTranslation.isReverse,
                timestamp: streamingTranslation.timestamp,
                isComplete: false,
                _isStreaming: true,
            };
            return [...filteredTranslations, streamingEntry];
        }
        return filteredTranslations;
    }, [accumulatedTranslations, streamingTranslation, recording]);

    // 自動捲動到底部
    useEffect(() => {
        sourceBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        targetBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [accumulatedTranslations, streamingTranslation]);

    const getStatusColor = (status: ConnectionStatus): string => {
        switch (status) {
            case 'connected':
                return '#4caf50';
            case 'connecting':
                return '#ff9800';
            case 'disconnected':
                return '#f44336';
            case 'error':
                return '#f44336';
            default:
                return '#9e9e9e';
        }
    };

    const getStatusText = (status: ConnectionStatus): string => {
        switch (status) {
            case 'connected':
                return '已連線';
            case 'connecting':
                return '連線中...';
            case 'disconnected':
                return '已斷線';
            case 'error':
                return '連線錯誤';
            default:
                return '未知';
        }
    };

    const formatTime = (timestamp: string): string => {
        return new Date(timestamp).toLocaleTimeString('zh-TW');
    };

    return (
        <div className="app">
            <header className="header">
                <h1>🌐 即時翻譯系統</h1>
                <div className="status">
                    <span
                        className="status-dot"
                        style={{ backgroundColor: getStatusColor(status) }}
                    />
                    <span>{getStatusText(status)}</span>
                </div>
            </header>

            {/* 語言選擇列 */}
            <div className="lang-bar">
                <div className="lang-select-group">
                    <label>護理端 (來源語言)</label>
                    <select
                        value={sourceLang}
                        onChange={(e) => setSourceLang(e.target.value as LangCode)}
                        disabled={status !== 'connected'}
                    >
                        {LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                                {lang.label}
                            </option>
                        ))}
                    </select>
                </div>

                <span className="lang-arrow">→</span>

                <div className="lang-select-group">
                    <label>病人端 (目標語言)</label>
                    <select
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value as LangCode)}
                        disabled={status !== 'connected'}
                    >
                        {LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                                {lang.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <main className="main">
                {/* 翻譯區域 - 雙欄顯示 */}
                <div className="translation-container">
                    <div className="translation-column source">
                        <div className="column-header">
                            <h3>🎤 護理端</h3>
                            <span className="lang-badge">{LANGUAGES.find(l => l.code === sourceLang)?.label}</span>
                        </div>
                        <div className="translation-list">
                            {items.length === 0 ? (
                                <p className="no-translations">開始錄音後，原文會顯示在這裡</p>
                            ) : (
                                items.map((entry, index) => {
                                    // 只有最後一個未完成且非 streaming 的泡泡才顯示綠色（累積中）
                                    const isLastItem = index === items.length - 1;
                                    const showAccumulating = isLastItem && !entry.isComplete && !entry._isStreaming;
                                    return (
                                        <div
                                            key={entry.id}
                                            className={`translation-item ${entry._isStreaming ? 'streaming' : ''} ${showAccumulating ? 'accumulating' : ''}`}
                                        >
                                            <p>{entry.displaySourceText || entry.sourceText || '🎤 聆聽中...'}</p>
                                            <span className="translation-time">
                                                {formatTime(entry.timestamp)}
                                                {entry._isStreaming && ' · 翻譯中…'}
                                                {showAccumulating && entry.sourceText && ' · 累積中…'}
                                                {showAccumulating && !entry.sourceText && ' · 等待語音...'}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={sourceBottomRef} />
                        </div>
                    </div>

                    <div className="translation-column target">
                        <div className="column-header">
                            <h3>🔊 病人端</h3>
                            <span className="lang-badge">{LANGUAGES.find(l => l.code === targetLang)?.label}</span>
                        </div>
                        <div className="translation-list">
                            {items.length === 0 ? (
                                <p className="no-translations">翻譯結果會顯示在這裡</p>
                            ) : (
                                items.map((entry, index) => {
                                    // 只有最後一個未完成且非 streaming 的泡泡才顯示綠色（累積中）
                                    const isLastItem = index === items.length - 1;
                                    const showAccumulating = isLastItem && !entry.isComplete && !entry._isStreaming;
                                    return (
                                        <div
                                            key={entry.id}
                                            className={`translation-item ${entry._isStreaming ? 'streaming' : ''} ${showAccumulating ? 'accumulating' : ''}`}
                                        >
                                            <p>{entry.displayTargetText || entry.targetText || '⏳ 等待翻譯...'}</p>
                                            <span className="translation-time">
                                                {formatTime(entry.timestamp)}
                                                {entry._isStreaming && ' · 翻譯中…'}
                                                {showAccumulating && entry.targetText && ' · 累積中…'}
                                                {showAccumulating && !entry.targetText && ' · 等待語音...'}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={targetBottomRef} />
                        </div>
                    </div>
                </div>

                {/* 錄音控制 */}
                <div className="recording-controls">
                    <button
                        onClick={recording ? handleStopRecording : handleStartRecording}
                        disabled={status !== 'connected'}
                        className={`record-btn large ${recording ? 'recording' : ''}`}
                    >
                        {recording ? '⏹️ 結束對話' : '🎤 開始對話'}
                    </button>
                    <button
                        onClick={() => clearTranslations()}
                        disabled={accumulatedTranslations.length === 0}
                        className="clear-btn"
                    >
                        清除翻譯
                    </button>
                </div>

                {/* 錄音錯誤提示 */}
                {recorderError && (
                    <div className="error-message">
                        {recorderError}
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;

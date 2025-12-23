// src/components/TranslationBubble.tsx
import React from 'react';
import type { LangCode, TranslationEntry, AccumulatedEntry } from '../hooks/useSocket';
import { useTypewriter } from '../hooks/useTypewriter';
import './TranslationBubble.css';

// 語言標籤對照
const LANG_LABEL: Record<LangCode, string> = {
    'zh-TW': '中文',
    'en': 'English',
    'vi': 'Tiếng Việt',
    'id': 'Indonesia',
    'th': 'ไทย',
    'ja': '日本語',
    'ko': '한국어',
};

// 格式化時間
function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

interface TranslationBubbleProps {
    /** 翻譯條目 (可以是 TranslationEntry 或 AccumulatedEntry) */
    entry: TranslationEntry | AccumulatedEntry;
    /** 是否為目前 streaming 中的那一筆 */
    isStreaming?: boolean;
    /** 是否為累積中（等待更多內容） */
    isAccumulating?: boolean;
    /** 顯示模式: 'source' 顯示原文, 'target' 顯示譯文, 'both' 顯示兩者 */
    displayMode?: 'source' | 'target' | 'both';
    /** 打字機速度 (ms) */
    typewriterSpeed?: number;
    /** 是否啟用打字機效果 */
    enableTypewriter?: boolean;
}

export const TranslationBubble: React.FC<TranslationBubbleProps> = ({
    entry,
    isStreaming = false,
    isAccumulating = false,
    displayMode = 'both',
    typewriterSpeed = 35,
    enableTypewriter = true,
}) => {
    // 判斷是否為 AccumulatedEntry
    const isAccumulatedEntry = 'displaySourceText' in entry;

    // 取得要顯示的文字
    const sourceText = isAccumulatedEntry
        ? (entry as AccumulatedEntry).displaySourceText || (entry as AccumulatedEntry).sourceText
        : entry.sourceText;

    const targetText = isAccumulatedEntry
        ? (entry as AccumulatedEntry).displayTargetText || (entry as AccumulatedEntry).targetText
        : entry.targetText;

    // 使用打字機效果 (只對 targetText 使用，因為 sourceText 通常會先完成)
    const { displayed: displayedTarget, isDone: isTargetDone } = useTypewriter(targetText || '', {
        speedMs: isStreaming ? 20 : typewriterSpeed,
        enabled: enableTypewriter && !isAccumulatedEntry, // AccumulatedEntry 已經有自己的打字機邏輯
    });

    // 決定實際顯示的譯文
    const finalTargetText = isAccumulatedEntry ? targetText : displayedTarget;

    // 計算狀態文字
    const getStatusText = () => {
        if (isStreaming) return ' · 翻譯中…';
        if (isAccumulating) {
            if (sourceText) return ' · 累積中…';
            return ' · 等待語音...';
        }
        if (!isTargetDone && enableTypewriter && !isAccumulatedEntry) return ' · 顯示中…';
        return '';
    };

    // 組合 className
    const bubbleClassName = [
        'translation-bubble',
        isStreaming && 'streaming',
        isAccumulating && 'accumulating',
    ].filter(Boolean).join(' ');

    return (
        <div className={bubbleClassName}>
            {/* 標頭：語言對和時間 */}
            <div className="bubble-header">
                <span className="lang-pair">
                    {LANG_LABEL[entry.sourceLang]} → {LANG_LABEL[entry.targetLang]}
                </span>
                <span className="timestamp">
                    {formatTime(entry.timestamp)}
                    {getStatusText()}
                </span>
            </div>

            {/* 原文區塊 */}
            {(displayMode === 'source' || displayMode === 'both') && (
                <div className="bubble-source">
                    {sourceText || '🎤 聆聽中...'}
                </div>
            )}

            {/* 譯文區塊（使用打字機效果） */}
            {(displayMode === 'target' || displayMode === 'both') && (
                <div className="bubble-target">
                    {finalTargetText || '⏳ 等待翻譯...'}
                </div>
            )}
        </div>
    );
};

export default TranslationBubble;

// src/hooks/useTypewriter.ts
import { useEffect, useRef, useState } from 'react';

/**
 * 打字機效果，將 text 逐字顯示出來
 * - 支援 text 動態變長（例如 streaming partial）
 * - 若 text 與目前顯示不相容（不是 prefix），會自動重頭開始打
 */
export function useTypewriter(
    text: string,
    options?: {
        speedMs?: number;      // 每個字的間隔 (ms)
        enabled?: boolean;     // 是否啟用打字效果（關閉就是直接顯示完整）
    }
) {
    const { speedMs = 30, enabled = true } = options || {};

    const [displayed, setDisplayed] = useState('');
    const indexRef = useRef(0);
    const targetRef = useRef(text);
    const timerRef = useRef<number | null>(null);

    // 每次 text 改變時，決定要「延續」還是「重頭開始」
    useEffect(() => {
        targetRef.current = text || '';

        // 如果關閉打字效果，直接顯示完整文字
        if (!enabled) {
            setDisplayed(targetRef.current);
            indexRef.current = targetRef.current.length;
            return;
        }

        // 如果目前顯示的字不是新文字的 prefix，重頭開始
        if (!targetRef.current.startsWith(displayed)) {
            setDisplayed('');
            indexRef.current = 0;
        } else {
            // 否則從目前長度繼續打
            indexRef.current = displayed.length;
        }
    }, [text, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // 控制打字計時器
    useEffect(() => {
        if (!enabled) return;
        if (!targetRef.current) {
            setDisplayed('');
            indexRef.current = 0;
            return;
        }

        // 如果已經全部打完，就不用再跑
        if (indexRef.current >= targetRef.current.length) {
            return;
        }

        const tick = () => {
            const target = targetRef.current;
            if (indexRef.current < target.length) {
                indexRef.current += 1;
                setDisplayed(target.slice(0, indexRef.current));

                timerRef.current = window.setTimeout(tick, speedMs);
            }
        };

        // 啟動一次
        timerRef.current = window.setTimeout(tick, speedMs);

        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [text, enabled, speedMs]); // text 變動時會重新調整

    const isDone = displayed === (text || '');

    return { displayed, isDone };
}

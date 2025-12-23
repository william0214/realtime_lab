import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from './useTypewriter';

describe('useTypewriter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('should display text character by character', () => {
        const { result } = renderHook(() =>
            useTypewriter('Hello', { speedMs: 50, enabled: true })
        );

        expect(result.current.displayed).toBe('');
        expect(result.current.isDone).toBe(false);

        // First character
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('H');

        // Second character
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('He');

        // Third character
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hel');

        // Fourth character
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hell');

        // Fifth character (last)
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hello');
        expect(result.current.isDone).toBe(true);
    });

    it('should handle empty text', () => {
        const { result } = renderHook(() =>
            useTypewriter('', { speedMs: 50, enabled: true })
        );

        expect(result.current.displayed).toBe('');
        expect(result.current.isDone).toBe(true);
    });

    it('should handle disabled typewriter - display full text immediately', () => {
        const { result } = renderHook(() =>
            useTypewriter('Hello', { speedMs: 50, enabled: false })
        );

        // 當 disabled 時，應該立即顯示完整文字
        expect(result.current.displayed).toBe('Hello');
        expect(result.current.isDone).toBe(true);

        // 時間推進也不會改變
        act(() => vi.advanceTimersByTime(500));
        expect(result.current.displayed).toBe('Hello');
    });

    it('should reset when text changes with prefix continuity', () => {
        const { result, rerender } = renderHook(
            ({ text, options }: { text: string; options: { speedMs: number; enabled: boolean } }) => useTypewriter(text, options),
            {
                initialProps: {
                    text: 'Hello',
                    options: { speedMs: 50, enabled: true },
                },
            }
        );

        // Advance to display "Hello"
        act(() => vi.advanceTimersByTime(250));
        expect(result.current.displayed).toBe('Hello');

        // Change text to "Hello World" - should continue from "Hello"
        rerender({
            text: 'Hello World',
            options: { speedMs: 50, enabled: true },
        });

        // Should have displayed all of "Hello" instantly as it's a prefix
        expect(result.current.displayed).toBe('Hello');

        // Next character should be space
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hello ');

        // Next character should be W
        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hello W');
    });

    it('should handle Chinese text', () => {
        const { result } = renderHook(() =>
            useTypewriter('你好', { speedMs: 50, enabled: true })
        );

        expect(result.current.displayed).toBe('');

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('你');

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('你好');
        expect(result.current.isDone).toBe(true);
    });

    it('should handle text with special characters', () => {
        const { result } = renderHook(() =>
            useTypewriter('Hello, 世界! 🌍', { speedMs: 50, enabled: true })
        );

        // Advance through all characters
        for (let i = 0; i < 13; i++) {
            act(() => vi.advanceTimersByTime(50));
        }

        expect(result.current.displayed).toBe('Hello, 世界! 🌍');
        expect(result.current.isDone).toBe(true);
    });

    it('should use custom speed', () => {
        const { result } = renderHook(() =>
            useTypewriter('AB', { speedMs: 100, enabled: true })
        );

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('');

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('A');

        act(() => vi.advanceTimersByTime(100));
        expect(result.current.displayed).toBe('AB');
        expect(result.current.isDone).toBe(true);
    });

    it('should handle text reset to shorter text', () => {
        const { result, rerender } = renderHook(
            ({ text, options }: { text: string; options: { speedMs: number; enabled: boolean } }) => useTypewriter(text, options),
            {
                initialProps: {
                    text: 'Hello World',
                    options: { speedMs: 50, enabled: true },
                },
            }
        );

        act(() => vi.advanceTimersByTime(250));

        // Change to shorter text
        rerender({
            text: 'Hi',
            options: { speedMs: 50, enabled: true },
        });

        // Should reset and start over
        expect(result.current.displayed).toBe('');

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('H');

        act(() => vi.advanceTimersByTime(50));
        expect(result.current.displayed).toBe('Hi');
        expect(result.current.isDone).toBe(true);
    });
});

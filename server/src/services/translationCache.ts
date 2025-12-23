/**
 * 翻譯快取服務
 * 避免重複翻譯相同內容，節省 API 費用
 */

interface CachedItem {
    result: string;
    createdAt: number;
    accessCount: number;
}

interface CacheConfig {
    maxEntries: number;
    expirationMs: number;
    enableSimilarMatch: boolean;
    similarityThreshold: number;
}

const DEFAULT_CONFIG: CacheConfig = {
    maxEntries: 500,
    expirationMs: 20 * 60 * 1000, // 20 分鐘
    enableSimilarMatch: false,    // 暫時停用相似度匹配（避免誤配）
    similarityThreshold: 0.95,    // 提高到 95% 避免誤配
};

export class TranslationCache {
    private storage = new Map<string, CachedItem>();
    private config: CacheConfig;
    private metrics = { hit: 0, miss: 0, similarHit: 0 };

    constructor(config: Partial<CacheConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 建立快取鍵
     */
    private buildKey(text: string, from: string, to: string): string {
        return `${from}|${to}|${text.trim().toLowerCase()}`;
    }

    /**
     * 計算文字相似度 (簡化版)
     */
    private getSimilarity(a: string, b: string): number {
        const s1 = a.toLowerCase();
        const s2 = b.toLowerCase();
        if (s1 === s2) return 1;

        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;

        if (longer.length === 0) return 1;

        // 簡單的包含檢查
        if (longer.includes(shorter)) {
            return shorter.length / longer.length;
        }

        // 計算共同字元比例
        let matches = 0;
        const chars = new Set(shorter.split(''));
        for (const char of longer) {
            if (chars.has(char)) matches++;
        }
        return matches / longer.length;
    }

    /**
     * 查詢快取
     */
    get(text: string, from: string, to: string): string | null {
        const key = this.buildKey(text, from, to);
        const item = this.storage.get(key);

        // 精確匹配
        if (item) {
            if (Date.now() - item.createdAt > this.config.expirationMs) {
                this.storage.delete(key);
                this.metrics.miss++;
                return null;
            }
            item.accessCount++;
            this.metrics.hit++;
            return item.result;
        }

        // 相似匹配
        if (this.config.enableSimilarMatch) {
            const prefix = `${from}|${to}|`;
            for (const [cachedKey, cachedItem] of this.storage.entries()) {
                if (!cachedKey.startsWith(prefix)) continue;

                const cachedText = cachedKey.slice(prefix.length);
                const similarity = this.getSimilarity(text.trim().toLowerCase(), cachedText);

                if (similarity >= this.config.similarityThreshold) {
                    if (Date.now() - cachedItem.createdAt <= this.config.expirationMs) {
                        cachedItem.accessCount++;
                        this.metrics.similarHit++;
                        return cachedItem.result;
                    }
                }
            }
        }

        this.metrics.miss++;
        return null;
    }

    /**
     * 儲存翻譯結果
     */
    set(text: string, from: string, to: string, result: string): void {
        // 清理過期或超量
        if (this.storage.size >= this.config.maxEntries) {
            this.evictOldest();
        }

        const key = this.buildKey(text, from, to);
        this.storage.set(key, {
            result,
            createdAt: Date.now(),
            accessCount: 1,
        });
    }

    /**
     * 移除最舊的項目
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, item] of this.storage.entries()) {
            if (item.createdAt < oldestTime) {
                oldestTime = item.createdAt;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.storage.delete(oldestKey);
        }
    }

    /**
     * 取得統計資訊
     */
    getMetrics(): { hit: number; miss: number; similarHit: number; size: number; hitRate: string } {
        const total = this.metrics.hit + this.metrics.miss + this.metrics.similarHit;
        const hitRate = total > 0
            ? ((this.metrics.hit + this.metrics.similarHit) / total * 100).toFixed(1) + '%'
            : '0%';

        return {
            ...this.metrics,
            size: this.storage.size,
            hitRate,
        };
    }

    /**
     * 清空快取
     */
    clear(): void {
        this.storage.clear();
        this.metrics = { hit: 0, miss: 0, similarHit: 0 };
    }
}

let cacheInstance: TranslationCache | null = null;

export function getTranslationCache(): TranslationCache {
    if (!cacheInstance) {
        cacheInstance = new TranslationCache();
    }
    return cacheInstance;
}

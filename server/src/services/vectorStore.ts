/**
 * 向量儲存服務 — 輕量級本地 RAG
 *
 * 使用 OpenAI text-embedding-3-small 生成 embedding，
 * 以 JSON 檔案持久化，cosine similarity 搜尋。
 * 適合小型術語庫（每領域 50-200 筆），無需外部服務。
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { type DomainCode } from './domainService';

// ============ 型別 ============

export interface GlossaryEntry {
    id: string;
    term: string;           // 術語原文
    termEn: string;         // 術語英文
    definition: string;     // 定義 / 解釋
    context?: string;       // 使用場景或例句
    domain: DomainCode;
}

interface VectorEntry {
    id: string;
    embedding: number[];
    metadata: GlossaryEntry;
}

interface VectorCollection {
    domain: DomainCode;
    model: string;
    dimensions: number;
    entries: VectorEntry[];
    updatedAt: string;
}

// ============ 設定 ============

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 256; // 降維到 256，足夠術語匹配且省空間
const DATA_DIR = path.join(__dirname, '../../data/vectors');
const DEFAULT_TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.3; // 低於此分數不回傳

// ============ 工具函數 ============

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============ VectorStore 類別 ============

export class VectorStore {
    private openai: OpenAI;
    private collections = new Map<DomainCode, VectorCollection>();
    private initialized = false;

    constructor(apiKey: string) {
        this.openai = new OpenAI({ apiKey });
    }

    /**
     * 初始化：從磁碟載入已有的向量資料
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // 確保資料目錄存在
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        // 載入所有已有的 collection 檔案
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const filePath = path.join(DATA_DIR, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VectorCollection;
                this.collections.set(data.domain, data);
                console.log(`📦 [VectorStore] Loaded ${data.entries.length} entries for domain: ${data.domain}`);
            } catch (error) {
                console.error(`🚨 [VectorStore] Failed to load ${file}:`, error);
            }
        }

        this.initialized = true;
        console.log(`✅ [VectorStore] Initialized with ${this.collections.size} domain(s)`);
    }

    /**
     * 生成 embedding 向量
     */
    private async embed(text: string): Promise<number[]> {
        const response = await this.openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text,
            dimensions: EMBEDDING_DIMENSIONS,
        });
        return response.data[0].embedding;
    }

    /**
     * 批次生成 embedding
     */
    private async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        // OpenAI 支援批次 embedding（最多 2048 筆）
        const response = await this.openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: texts,
            dimensions: EMBEDDING_DIMENSIONS,
        });

        return response.data
            .sort((a, b) => a.index - b.index)
            .map(d => d.embedding);
    }

    /**
     * 新增單筆術語
     */
    async addEntry(entry: GlossaryEntry): Promise<void> {
        await this.init();

        // 組合搜尋文字：term + definition 讓語意搜尋更精確
        const searchText = `${entry.term} ${entry.termEn} ${entry.definition}`;
        const embedding = await this.embed(searchText);

        const vectorEntry: VectorEntry = {
            id: entry.id,
            embedding,
            metadata: entry,
        };

        let collection = this.collections.get(entry.domain);
        if (!collection) {
            collection = {
                domain: entry.domain,
                model: EMBEDDING_MODEL,
                dimensions: EMBEDDING_DIMENSIONS,
                entries: [],
                updatedAt: new Date().toISOString(),
            };
            this.collections.set(entry.domain, collection);
        }

        // 如果已存在同 ID，更新
        const existingIdx = collection.entries.findIndex(e => e.id === entry.id);
        if (existingIdx >= 0) {
            collection.entries[existingIdx] = vectorEntry;
        } else {
            collection.entries.push(vectorEntry);
        }

        collection.updatedAt = new Date().toISOString();
        this.saveCollection(entry.domain);
    }

    /**
     * 批次新增術語（效率更高）
     */
    async addEntries(entries: GlossaryEntry[]): Promise<void> {
        await this.init();

        if (entries.length === 0) return;

        // 按領域分組
        const byDomain = new Map<DomainCode, GlossaryEntry[]>();
        for (const entry of entries) {
            const list = byDomain.get(entry.domain) || [];
            list.push(entry);
            byDomain.set(entry.domain, list);
        }

        for (const [domain, domainEntries] of byDomain) {
            const texts = domainEntries.map(e => `${e.term} ${e.termEn} ${e.definition}`);
            const embeddings = await this.embedBatch(texts);

            let collection = this.collections.get(domain);
            if (!collection) {
                collection = {
                    domain,
                    model: EMBEDDING_MODEL,
                    dimensions: EMBEDDING_DIMENSIONS,
                    entries: [],
                    updatedAt: new Date().toISOString(),
                };
                this.collections.set(domain, collection);
            }

            for (let i = 0; i < domainEntries.length; i++) {
                const vectorEntry: VectorEntry = {
                    id: domainEntries[i].id,
                    embedding: embeddings[i],
                    metadata: domainEntries[i],
                };

                const existingIdx = collection.entries.findIndex(e => e.id === domainEntries[i].id);
                if (existingIdx >= 0) {
                    collection.entries[existingIdx] = vectorEntry;
                } else {
                    collection.entries.push(vectorEntry);
                }
            }

            collection.updatedAt = new Date().toISOString();
            this.saveCollection(domain);

            console.log(`📦 [VectorStore] Added ${domainEntries.length} entries to domain: ${domain}`);
        }
    }

    /**
     * 查詢術語：根據輸入文字找最相關的術語
     */
    async queryGlossary(
        domain: DomainCode,
        text: string,
        topK: number = DEFAULT_TOP_K
    ): Promise<Array<{ entry: GlossaryEntry; score: number }>> {
        await this.init();

        const collection = this.collections.get(domain);
        if (!collection || collection.entries.length === 0) {
            return [];
        }

        const queryEmbedding = await this.embed(text);

        // 計算 cosine similarity 並排序
        const scored = collection.entries
            .map(entry => ({
                entry: entry.metadata,
                score: cosineSimilarity(queryEmbedding, entry.embedding),
            }))
            .filter(item => item.score >= SIMILARITY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        return scored;
    }

    /**
     * 取得特定領域的所有術語數量
     */
    getEntryCount(domain: DomainCode): number {
        return this.collections.get(domain)?.entries.length || 0;
    }

    /**
     * 取得所有領域的統計
     */
    getStats(): Record<string, number> {
        const stats: Record<string, number> = {};
        for (const [domain, collection] of this.collections) {
            stats[domain] = collection.entries.length;
        }
        return stats;
    }

    /**
     * 儲存 collection 到磁碟
     */
    private saveCollection(domain: DomainCode): void {
        const collection = this.collections.get(domain);
        if (!collection) return;

        const filePath = path.join(DATA_DIR, `${domain}.json`);
        fs.writeFileSync(filePath, JSON.stringify(collection, null, 2), 'utf-8');
    }
}

// ============ 單例工廠 ============

let vectorStoreInstance: VectorStore | null = null;

export function getVectorStore(apiKey?: string): VectorStore {
    if (!vectorStoreInstance) {
        const key = apiKey || process.env.OPENAI_API_KEY || '';
        if (!key) {
            throw new Error('OPENAI_API_KEY is required for VectorStore');
        }
        vectorStoreInstance = new VectorStore(key);
    }
    return vectorStoreInstance;
}

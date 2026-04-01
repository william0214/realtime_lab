#!/usr/bin/env npx ts-node
/**
 * seedGlossary.ts — 將 server/data/glossaries/*.json 種子資料載入到 VectorStore
 *
 * 用法：
 *   cd server && npx ts-node src/scripts/seedGlossary.ts
 *   cd server && npx ts-node src/scripts/seedGlossary.ts medical   # 只載入特定領域
 *
 * 需要環境變數：
 *   OPENAI_API_KEY — 用於生成 embedding
 */

import path from 'path';
import fs from 'fs';
import { VectorStore, type GlossaryEntry } from '../services/vectorStore';
import { type DomainCode } from '../services/domainService';

const GLOSSARY_DIR = path.join(__dirname, '../../data/glossaries');
const VALID_DOMAINS: DomainCode[] = ['medical', 'legal', 'finance', 'tech', 'business', 'aviation'];

async function main() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('❌ 請設定 OPENAI_API_KEY 環境變數');
        process.exit(1);
    }

    // 決定要載入哪些領域
    const targetDomain = process.argv[2] as DomainCode | undefined;
    const domains = targetDomain
        ? [targetDomain]
        : VALID_DOMAINS;

    if (targetDomain && !VALID_DOMAINS.includes(targetDomain)) {
        console.error(`❌ 不支援的領域: ${targetDomain}`);
        console.error(`   可用領域: ${VALID_DOMAINS.join(', ')}`);
        process.exit(1);
    }

    const store = new VectorStore(apiKey);
    await store.init();

    let totalEntries = 0;

    for (const domain of domains) {
        const filePath = path.join(GLOSSARY_DIR, `${domain}.json`);

        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  跳過 ${domain}：找不到 ${filePath}`);
            continue;
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const entries: GlossaryEntry[] = JSON.parse(raw);

        console.log(`\n📖 載入 ${domain} 領域 (${entries.length} 筆)...`);

        // 批次加入，每批 20 筆避免 API rate limit
        const BATCH_SIZE = 20;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);
            await store.addEntries(batch);
            console.log(`   ✅ ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}`);
        }

        totalEntries += entries.length;
    }

    console.log(`\n🎉 完成！共載入 ${totalEntries} 筆術語到 ${domains.length} 個領域`);
}

main().catch(err => {
    console.error('❌ Seed 失敗:', err);
    process.exit(1);
});

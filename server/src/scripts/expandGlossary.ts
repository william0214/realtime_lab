#!/usr/bin/env npx ts-node
/**
 * expandGlossary.ts — 全自動術語擴充管線
 *
 * 三個來源（可同時或單獨執行）：
 *   1. LLM（GPT-4o-mini）：根據現有術語生成同義詞 / 相關術語
 *   2. Wikidata SPARQL（免費，無需 API Key）：從 Wikidata 抓取術語
 *   3. MeSH REST API（NLM，免費，僅醫療領域）
 *
 * 用法：
 *   cd server
 *   npx ts-node src/scripts/expandGlossary.ts                          # 所有領域，所有來源
 *   npx ts-node src/scripts/expandGlossary.ts medical                  # 只擴充醫療領域
 *   npx ts-node src/scripts/expandGlossary.ts medical --source=mesh    # 指定來源
 *   npx ts-node src/scripts/expandGlossary.ts --dry-run                # 不寫入，只印出
 *
 * 需要：
 *   OPENAI_API_KEY — 用於 LLM 擴充 + embedding
 */

import path from 'path';
import fs from 'fs';
import https from 'https';
import OpenAI from 'openai';
import { type DomainCode } from '../services/domainService';
import { type GlossaryEntry } from '../services/vectorStore';

// ============ CLI 參數 ============

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const sourceArg = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? 'all';
const domainArg = args.find(a => !a.startsWith('--')) as DomainCode | undefined;

const VALID_DOMAINS: DomainCode[] = ['medical', 'legal', 'finance', 'tech', 'business', 'aviation'];
const VALID_SOURCES = ['llm', 'wikidata', 'mesh', 'all'];

// ============ Wikidata 領域 → Category QID ============

const WIKIDATA_CATEGORIES: Record<DomainCode, string[]> = {
    medical:  ['Q12136', 'Q169872', 'Q11190'],   // disease, symptom, medicine
    legal:    ['Q3455524', 'Q7748', 'Q40231'],    // legal term, law, statute
    finance:  ['Q43015', 'Q8134', 'Q837371'],     // finance, economics, accounting
    tech:     ['Q11661', 'Q21198', 'Q80006'],     // information technology, computer science, software
    business: ['Q4830453', 'Q268592', 'Q39911'],  // business, management, commerce
    aviation: ['Q1535345', 'Q2166092', 'Q11436'], // aviation, aeronautics, aircraft
    general:  [],
};

// ============ MeSH tree numbers（醫療領域） ============

const MESH_TREE_NUMBERS = ['C14', 'C08', 'C09', 'F03', 'D26']; // Cardiovascular, Respiratory, Ear/Nose/Throat, Mental, Diagnostic agents

// ============ 工具 ============

async function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'GlossaryExpander/1.0' } }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function dedupTerms(existing: GlossaryEntry[], candidates: Omit<GlossaryEntry, 'id'>[]): Omit<GlossaryEntry, 'id'>[] {
    const existingTermsLower = new Set(existing.map(e => e.term.toLowerCase().trim()));
    const existingEnLower   = new Set(existing.map(e => e.termEn.toLowerCase().trim()));
    return candidates.filter(c =>
        !existingTermsLower.has(c.term.toLowerCase().trim()) &&
        !existingEnLower.has(c.termEn.toLowerCase().trim()),
    );
}

function assignIds(domain: DomainCode, existing: GlossaryEntry[], newEntries: Omit<GlossaryEntry, 'id'>[]): GlossaryEntry[] {
    const prefix = domain.slice(0, 3); // e.g. 'med', 'avi'
    const maxId = existing.reduce((max, e) => {
        const n = parseInt(e.id.replace(`${prefix}-`, ''), 10);
        return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return newEntries.map((e, i) => ({
        ...e,
        id: `${prefix}-${String(maxId + i + 1).padStart(3, '0')}`,
    }));
}

// ============ 1. LLM 擴充（GPT-4o-mini） ============

async function expandFromLLM(
    openai: OpenAI,
    domain: DomainCode,
    existing: GlossaryEntry[],
    targetCount = 20,
): Promise<Omit<GlossaryEntry, 'id'>[]> {
    console.log(`  [LLM] 生成 ${targetCount} 筆 ${domain} 術語...`);

    const sampleTerms = existing
        .slice(0, 10)
        .map(e => `${e.term}（${e.termEn}）`)
        .join(', ');

    const prompt = `你是${domain}領域的專業術語庫編輯。
現有術語範例：${sampleTerms}

請生成 ${targetCount} 筆新的${domain}領域常用專業術語（繁體中文），這些術語必須：
1. 不重複上方範例
2. 涵蓋常見會議用語或關鍵概念
3. 數字/單位必須精確

請以 JSON 陣列回覆，每個物件格式：
{"term":"術語（繁中）","termEn":"English term","definition":"簡短中文定義（20字內）","context":"使用場景（可選）"}

只輸出 JSON 陣列，不要其他文字。`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    let parsed: Omit<GlossaryEntry, 'id' | 'domain'>[];
    try {
        // response_format json_object may wrap in a key
        const obj = JSON.parse(raw);
        parsed = Array.isArray(obj) ? obj : (obj.terms ?? obj.entries ?? obj.glossary ?? Object.values(obj)[0]);
        if (!Array.isArray(parsed)) throw new Error('not array');
    } catch (e) {
        console.warn(`  [LLM] JSON 解析失敗: ${(e as Error).message}`);
        return [];
    }

    return parsed
        .filter(e => e.term && e.termEn && e.definition)
        .map(e => ({ ...e, domain }));
}

// ============ 2. Wikidata SPARQL ============

async function expandFromWikidata(
    domain: DomainCode,
    existing: GlossaryEntry[],
    targetCount = 20,
): Promise<Omit<GlossaryEntry, 'id'>[]> {
    const qids = WIKIDATA_CATEGORIES[domain];
    if (!qids.length) return [];

    console.log(`  [Wikidata] 查詢 ${domain} 術語 (QIDs: ${qids.join(', ')})...`);

    const results: Omit<GlossaryEntry, 'id'>[] = [];

    for (const qid of qids) {
        if (results.length >= targetCount) break;

        const sparql = `
SELECT DISTINCT ?item ?itemLabel ?itemLabelZh ?itemLabelEn ?description WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid}.
  OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "zh-tw") }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "zh-tw,zh,en".
    ?item rdfs:label ?itemLabel.
    ?item rdfs:label ?itemLabelZh FILTER(LANG(?itemLabelZh) = "zh-tw").
    ?item rdfs:label ?itemLabelEn FILTER(LANG(?itemLabelEn) = "en").
  }
} LIMIT 30`;

        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;

        try {
            const body = await httpsGet(url);
            const data = JSON.parse(body);
            const bindings = data?.results?.bindings ?? [];

            for (const b of bindings) {
                const term    = b.itemLabelZh?.value ?? b.itemLabel?.value ?? '';
                const termEn  = b.itemLabelEn?.value ?? b.itemLabel?.value ?? '';
                const definition = b.description?.value ?? '';

                // 過濾：必須有中文 term 且不是 QID 格式
                if (!term || term.startsWith('Q') || !/[\u4e00-\u9fff]/.test(term)) continue;
                if (!termEn || /[\u4e00-\u9fff]/.test(termEn)) continue;

                results.push({ term, termEn, definition: definition || `${domain}相關術語`, domain });
                if (results.length >= targetCount) break;
            }
        } catch (e) {
            console.warn(`  [Wikidata] QID ${qid} 查詢失敗: ${(e as Error).message}`);
        }

        await sleep(500); // 尊重 Wikidata rate limit
    }

    return results;
}

// ============ 3. MeSH REST API（僅醫療） ============

async function expandFromMeSH(
    existing: GlossaryEntry[],
    targetCount = 20,
): Promise<Omit<GlossaryEntry, 'id'>[]> {
    console.log(`  [MeSH] 查詢醫療術語...`);
    const results: Omit<GlossaryEntry, 'id'>[] = [];

    for (const tree of MESH_TREE_NUMBERS) {
        if (results.length >= targetCount) break;

        const url = `https://id.nlm.nih.gov/mesh/lookup/descriptor?label=${tree}&match=startsWith&limit=20&offset=0`;
        try {
            const body = await httpsGet(url);
            const data: Array<{ label: string; resource: string }> = JSON.parse(body);

            for (const item of data) {
                if (results.length >= targetCount) break;
                const termEn = item.label ?? '';
                if (!termEn) continue;

                // 取得中文標籤（用 details endpoint）
                const term = await translateMeSHTerm(termEn);
                if (!term) continue;

                results.push({
                    term,
                    termEn,
                    definition: `醫療術語：${termEn}`,
                    domain: 'medical',
                });

                await sleep(200);
            }
        } catch (e) {
            console.warn(`  [MeSH] tree ${tree} 查詢失敗: ${(e as Error).message}`);
        }
    }

    return results;
}

async function translateMeSHTerm(termEn: string): Promise<string> {
    // 使用 MeSH descriptor detail API 取得 zh-TW 標籤
    const url = `https://id.nlm.nih.gov/mesh/lookup/descriptor?label=${encodeURIComponent(termEn)}&match=exact&limit=1`;
    try {
        const body = await httpsGet(url);
        const data: Array<{ label: string; resource: string }> = JSON.parse(body);
        if (!data.length) return '';

        const detailUrl = `${data[0].resource}.json`;
        const detail = await httpsGet(detailUrl);
        const parsed = JSON.parse(detail);

        // 尋找 conceptList → termList zh 標籤
        const concepts = parsed?.conceptList?.concept ?? [];
        for (const concept of concepts) {
            for (const t of concept?.termList?.term ?? []) {
                const lang = t?.langlabel?.lang ?? '';
                if (lang === 'zh-TW' || lang === 'zho') {
                    return t?.langlabel?.label ?? '';
                }
            }
        }
    } catch {
        // ignore individual failures
    }
    return '';
}

// ============ 主流程 ============

async function processDoamin(openai: OpenAI, domain: DomainCode): Promise<number> {
    const glossaryPath = path.join(__dirname, `../../data/glossaries/${domain}.json`);

    let existing: GlossaryEntry[] = [];
    if (fs.existsSync(glossaryPath)) {
        existing = JSON.parse(fs.readFileSync(glossaryPath, 'utf-8'));
    }

    console.log(`\n📂 [${domain}] 現有術語: ${existing.length} 筆`);

    const candidates: Omit<GlossaryEntry, 'id'>[] = [];

    if (sourceArg === 'llm' || sourceArg === 'all') {
        const llmTerms = await expandFromLLM(openai, domain, existing, 20);
        candidates.push(...llmTerms);
        console.log(`  [LLM] 取得 ${llmTerms.length} 筆`);
    }

    if (sourceArg === 'wikidata' || sourceArg === 'all') {
        const wikidataTerms = await expandFromWikidata(domain, existing, 20);
        candidates.push(...wikidataTerms);
        console.log(`  [Wikidata] 取得 ${wikidataTerms.length} 筆`);
    }

    if ((sourceArg === 'mesh' || sourceArg === 'all') && domain === 'medical') {
        const meshTerms = await expandFromMeSH(existing, 20);
        candidates.push(...meshTerms);
        console.log(`  [MeSH] 取得 ${meshTerms.length} 筆`);
    }

    // 去重
    const unique = dedupTerms(existing, candidates);
    console.log(`  去重後新術語: ${unique.length} 筆`);

    if (unique.length === 0) {
        console.log('  ✅ 無新術語需要新增');
        return 0;
    }

    const newEntries = assignIds(domain, existing, unique);

    if (isDryRun) {
        console.log('  [dry-run] 不寫入，預覽前 5 筆:');
        newEntries.slice(0, 5).forEach(e => {
            console.log(`    ${e.id}: ${e.term} (${e.termEn})`);
        });
        return newEntries.length;
    }

    // 寫入 JSON
    const updated = [...existing, ...newEntries];
    fs.writeFileSync(glossaryPath, JSON.stringify(updated, null, 2), 'utf-8');
    console.log(`  💾 已更新 ${glossaryPath}（${existing.length} → ${updated.length} 筆）`);

    return newEntries.length;
}

async function main() {
    // 驗證參數
    if (sourceArg && !VALID_SOURCES.includes(sourceArg)) {
        console.error(`❌ 不支援的來源: ${sourceArg}，可用: ${VALID_SOURCES.join(', ')}`);
        process.exit(1);
    }
    if (domainArg && !VALID_DOMAINS.includes(domainArg)) {
        console.error(`❌ 不支援的領域: ${domainArg}，可用: ${VALID_DOMAINS.join(', ')}`);
        process.exit(1);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey && (sourceArg === 'llm' || sourceArg === 'all')) {
        console.error('❌ OPENAI_API_KEY 未設定（LLM 擴充需要）');
        process.exit(1);
    }

    const openai = new OpenAI({ apiKey: apiKey ?? 'placeholder' });
    const domains = domainArg ? [domainArg] : VALID_DOMAINS;

    console.log(`🚀 expandGlossary — 來源: ${sourceArg}，領域: ${domains.join(', ')}${isDryRun ? '  [DRY RUN]' : ''}`);

    let totalAdded = 0;
    for (const domain of domains) {
        totalAdded += await processDoamin(openai, domain);
    }

    console.log(`\n🎉 完成！共新增 ${totalAdded} 筆術語${isDryRun ? '（dry-run，未寫入）' : ''}`);
    if (!isDryRun && totalAdded > 0) {
        console.log('\n📌 請記得重新執行 seedGlossary 以更新 VectorStore：');
        console.log('   npx ts-node src/scripts/seedGlossary.ts');
    }
}

main().catch(err => {
    console.error('❌ 擴充失敗:', err);
    process.exit(1);
});

/**
 * OpenAI vs Gemini 即時翻譯比較測試
 * 
 * 使用方式：
 *   npx ts-node src/realtime/comparison-test.ts
 */

import 'dotenv/config';
import { createRealtimeClient, RealtimeProvider } from './index';

interface TestResult {
    provider: RealtimeProvider;
    connectTime: number;
    connected: boolean;
    error?: string;
}

async function testProvider(provider: RealtimeProvider): Promise<TestResult> {
    const apiKey = provider === 'openai'
        ? process.env.OPENAI_API_KEY!
        : process.env.GOOGLE_API_KEY!;

    if (!apiKey) {
        return {
            provider,
            connectTime: 0,
            connected: false,
            error: `Missing API key for ${provider}`
        };
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Testing ${provider.toUpperCase()}`);
    console.log(`${'='.repeat(50)}`);

    const client = createRealtimeClient({
        provider,
        apiKey,
        sourceLang: 'zh-TW',
        targetLang: 'en',
        autoReconnect: false,
    });

    const startTime = Date.now();

    try {
        // 設定超時
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000);
        });

        await Promise.race([client.connect(), timeoutPromise]);

        const connectTime = Date.now() - startTime;
        console.log(`✅ Connected in ${connectTime}ms`);

        // 測試事件監聽
        client.onTranscript((transcript) => {
            console.log(`📝 Transcript: ${transcript}`);
        });

        client.onText((text) => {
            console.log(`🌐 Translation: ${text}`);
        });

        client.onTextDelta((delta) => {
            process.stdout.write(delta);
        });

        // 等待一下再斷開
        await new Promise(resolve => setTimeout(resolve, 1000));

        client.disconnect();
        console.log(`✅ Disconnected`);

        return {
            provider,
            connectTime,
            connected: true,
        };

    } catch (error) {
        const connectTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error: ${errorMessage}`);

        client.disconnect();

        return {
            provider,
            connectTime,
            connected: false,
            error: errorMessage,
        };
    }
}

async function main() {
    console.log('🔬 OpenAI vs Gemini 即時翻譯 API 比較測試');
    console.log('============================================\n');

    const results: TestResult[] = [];

    // 測試 OpenAI
    results.push(await testProvider('openai'));

    // 測試 Gemini
    results.push(await testProvider('gemini'));

    // 顯示比較結果
    console.log('\n');
    console.log('📊 比較結果');
    console.log('============================================');
    console.log('| Provider | Connect Time | Status          |');
    console.log('|----------|--------------|-----------------|');

    for (const result of results) {
        const status = result.connected ? '✅ Connected' : `❌ ${result.error?.slice(0, 15) || 'Failed'}`;
        const time = result.connected ? `${result.connectTime}ms` : '-';
        console.log(`| ${result.provider.padEnd(8)} | ${time.padEnd(12)} | ${status.padEnd(15)} |`);
    }

    console.log('============================================\n');

    // 醫療適用性建議
    console.log('🏥 醫療場景適用性建議：');
    console.log('----------------------------------------');
    console.log('| 項目           | OpenAI    | Gemini    |');
    console.log('|----------------|-----------|-----------|');
    console.log('| HIPAA BAA      | ⚠️ 需確認  | ✅ 支援    |');
    console.log('| 資料駐留       | ⚠️ 有限    | ✅ 可選區域 |');
    console.log('| 醫療術語       | ⚠️ 一般    | ✅ 專業模型 |');
    console.log('| 穩定性         | ✅ 穩定    | ⚠️ 預覽版   |');
    console.log('| 成本           | 💰 較高    | 💰 較低    |');
    console.log('----------------------------------------\n');
}

main().catch(console.error);

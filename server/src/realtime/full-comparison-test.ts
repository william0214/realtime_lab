/**
 * OpenAI vs Gemini 完整比較測試
 * 
 * 測試項目：
 * 1. 連線速度
 * 2. 語音轉錄準確度
 * 3. 轉錄延遲
 * 4. 翻譯品質
 * 5. 端到端延遲
 * 
 * 使用方式：
 *   cd server && npx tsx src/realtime/full-comparison-test.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { OpenAIRealtimeClient } from './openaiRealtimeClient';
import { GeminiRealtimeClient } from './geminiRealtimeClient';
import { RealtimeProvider } from './types';

// 測試句子資料
interface TestSentence {
    id: string;
    lang: string;
    langName: string;
    text: string;
    chinese: string;
    context: string;
}

// 測試結果
interface TestResult {
    provider: RealtimeProvider;
    sentenceId: string;
    expectedText: string;
    transcribedText: string;
    translatedText: string;
    connectTime: number;
    transcribeTime: number;
    translateTime: number;
    totalTime: number;
    transcriptAccuracy: number; // 0-100
    success: boolean;
    error?: string;
}

// 載入測試句子
function loadTestSentences(): TestSentence[] {
    const filePath = path.join(__dirname, '../../../tools/test-sentences.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.sentences;
}

// 將 MP3 轉換為 PCM16
async function convertMp3ToPcm(mp3Path: string, sampleRate: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', mp3Path,
            '-f', 's16le',
            '-acodec', 'pcm_s16le',
            '-ar', sampleRate.toString(),
            '-ac', '1',
            'pipe:1'
        ]);

        const chunks: Buffer[] = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => { /* 忽略 */ });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(Buffer.concat(chunks));
            } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', reject);
    });
}

// 計算文字相似度 (簡單的 Levenshtein 距離)
function calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
    const s2 = str2.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');

    if (s1 === s2) return 100;
    if (s1.length === 0 || s2.length === 0) return 0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    // 計算包含的字元比例
    let matches = 0;
    for (const char of shorter) {
        if (longer.includes(char)) matches++;
    }

    return Math.round((matches / longer.length) * 100);
}

// 測試單一 provider
async function testProvider(
    provider: RealtimeProvider,
    sentence: TestSentence,
    audioBuffer: Buffer
): Promise<TestResult> {
    const apiKey = provider === 'openai'
        ? process.env.OPENAI_API_KEY!
        : process.env.GOOGLE_API_KEY!;

    const result: TestResult = {
        provider,
        sentenceId: sentence.id,
        expectedText: sentence.text,
        transcribedText: '',
        translatedText: '',
        connectTime: 0,
        transcribeTime: 0,
        translateTime: 0,
        totalTime: 0,
        transcriptAccuracy: 0,
        success: false,
    };

    const startTime = Date.now();
    let transcriptStartTime = 0;
    let firstTranscriptTime = 0;
    let firstTextTime = 0;

    try {
        // 建立客戶端
        const client = provider === 'openai'
            ? new OpenAIRealtimeClient({
                apiKey,
                sourceLang: sentence.lang === 'zh' ? 'zh-TW' : sentence.lang,
                targetLang: sentence.lang === 'zh' ? 'en' : 'zh-TW',
            })
            : new GeminiRealtimeClient({
                apiKey,
                sourceLang: sentence.lang === 'zh' ? 'zh-TW' : sentence.lang,
                targetLang: sentence.lang === 'zh' ? 'en' : 'zh-TW',
            });

        // 連線
        const connectStart = Date.now();
        await Promise.race([
            client.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 15000))
        ]);
        result.connectTime = Date.now() - connectStart;

        // 設定事件監聽
        let transcriptComplete = false;
        let textComplete = false;

        const transcriptPromise = new Promise<string>((resolve) => {
            client.onTranscript((transcript) => {
                if (!firstTranscriptTime) {
                    firstTranscriptTime = Date.now();
                }
                result.transcribedText = transcript;
                transcriptComplete = true;
                resolve(transcript);
            });

            // 也監聽 delta
            client.onTranscriptDelta((delta, accumulated) => {
                if (!firstTranscriptTime) {
                    firstTranscriptTime = Date.now();
                }
                result.transcribedText = accumulated;
            });
        });

        const textPromise = new Promise<string>((resolve) => {
            client.onText((text) => {
                if (!firstTextTime) {
                    firstTextTime = Date.now();
                }
                result.translatedText = text;
                textComplete = true;
                resolve(text);
            });

            client.onTextDelta((delta) => {
                if (!firstTextTime) {
                    firstTextTime = Date.now();
                }
                result.translatedText += delta;
            });
        });

        // 發送音訊
        transcriptStartTime = Date.now();

        // 分段發送音訊（模擬串流）
        const chunkSize = 4800; // 約 0.1 秒的音訊
        for (let i = 0; i < audioBuffer.length; i += chunkSize) {
            const chunk = audioBuffer.slice(i, Math.min(i + chunkSize, audioBuffer.length));
            client.sendAudioChunk(chunk);
            await new Promise(resolve => setTimeout(resolve, 50)); // 模擬串流間隔
        }

        // 等待結果（最多 30 秒）
        const timeout = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Response timeout')), 30000)
        );

        try {
            await Promise.race([
                Promise.all([transcriptPromise, textPromise]),
                timeout
            ]);
        } catch (e) {
            // 如果超時但有部分結果，繼續處理
            console.log(`⚠️ [${provider}] Partial results available`);
        }

        // 計算時間
        if (firstTranscriptTime) {
            result.transcribeTime = firstTranscriptTime - transcriptStartTime;
        }
        if (firstTextTime) {
            result.translateTime = firstTextTime - (firstTranscriptTime || transcriptStartTime);
        }
        result.totalTime = Date.now() - startTime;

        // 計算準確度
        if (result.transcribedText) {
            result.transcriptAccuracy = calculateSimilarity(sentence.text, result.transcribedText);
        }

        result.success = result.transcribedText.length > 0;

        // 斷開連線
        client.disconnect();

    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.totalTime = Date.now() - startTime;
    }

    return result;
}

// 主測試函數
async function runFullComparison() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     OpenAI vs Gemini 完整比較測試                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // 檢查 API Keys
    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ Missing OPENAI_API_KEY');
        return;
    }
    if (!process.env.GOOGLE_API_KEY) {
        console.error('❌ Missing GOOGLE_API_KEY');
        return;
    }

    // 載入測試句子
    const sentences = loadTestSentences();

    // 選擇測試用的句子（中文和英文各 3 句）
    const testSentences = [
        ...sentences.filter(s => s.lang === 'zh').slice(0, 3),
        ...sentences.filter(s => s.lang === 'en').slice(0, 3),
    ];

    console.log(`📝 測試句子: ${testSentences.length} 句\n`);

    const results: TestResult[] = [];

    for (const sentence of testSentences) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📝 測試: ${sentence.id} - "${sentence.text.slice(0, 30)}..."`);
        console.log(`   語言: ${sentence.langName}, 情境: ${sentence.context}`);
        console.log(`${'─'.repeat(60)}`);

        // 載入音訊檔案
        const audioPath = path.join(__dirname, `../../../tools/audio/${sentence.id}.mp3`);
        if (!fs.existsSync(audioPath)) {
            console.log(`⚠️ 音訊檔案不存在: ${audioPath}`);
            continue;
        }

        // 測試 OpenAI (24kHz)
        console.log('\n🔵 Testing OpenAI...');
        const openaiAudio = await convertMp3ToPcm(audioPath, 24000);
        const openaiResult = await testProvider('openai', sentence, openaiAudio);
        results.push(openaiResult);
        printResult(openaiResult);

        // 等待一下避免 rate limit
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 測試 Gemini (16kHz)
        console.log('\n🟢 Testing Gemini...');
        const geminiAudio = await convertMp3ToPcm(audioPath, 16000);
        const geminiResult = await testProvider('gemini', sentence, geminiAudio);
        results.push(geminiResult);
        printResult(geminiResult);

        // 等待一下
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 輸出總結
    printSummary(results);
}

function printResult(result: TestResult) {
    const status = result.success ? '✅' : '❌';
    console.log(`   ${status} Provider: ${result.provider.toUpperCase()}`);
    console.log(`   📊 連線時間: ${result.connectTime}ms`);
    console.log(`   📊 轉錄時間: ${result.transcribeTime}ms`);
    console.log(`   📊 翻譯時間: ${result.translateTime}ms`);
    console.log(`   📊 總時間: ${result.totalTime}ms`);
    console.log(`   📊 轉錄準確度: ${result.transcriptAccuracy}%`);
    console.log(`   📝 期望: "${result.expectedText.slice(0, 40)}..."`);
    console.log(`   📝 轉錄: "${result.transcribedText.slice(0, 40)}..."`);
    console.log(`   📝 翻譯: "${result.translatedText.slice(0, 40)}..."`);
    if (result.error) {
        console.log(`   ⚠️ 錯誤: ${result.error}`);
    }
}

function printSummary(results: TestResult[]) {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           📊 測試結果總結                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝');

    const openaiResults = results.filter(r => r.provider === 'openai');
    const geminiResults = results.filter(r => r.provider === 'gemini');

    const avgOpenai = {
        connectTime: avg(openaiResults.map(r => r.connectTime)),
        transcribeTime: avg(openaiResults.map(r => r.transcribeTime)),
        translateTime: avg(openaiResults.map(r => r.translateTime)),
        totalTime: avg(openaiResults.map(r => r.totalTime)),
        accuracy: avg(openaiResults.map(r => r.transcriptAccuracy)),
        successRate: (openaiResults.filter(r => r.success).length / openaiResults.length) * 100,
    };

    const avgGemini = {
        connectTime: avg(geminiResults.map(r => r.connectTime)),
        transcribeTime: avg(geminiResults.map(r => r.transcribeTime)),
        translateTime: avg(geminiResults.map(r => r.translateTime)),
        totalTime: avg(geminiResults.map(r => r.totalTime)),
        accuracy: avg(geminiResults.map(r => r.transcriptAccuracy)),
        successRate: (geminiResults.filter(r => r.success).length / geminiResults.length) * 100,
    };

    console.log('\n┌─────────────────────┬────────────────┬────────────────┬─────────┐');
    console.log('│ 指標                │ OpenAI         │ Gemini         │ 勝出    │');
    console.log('├─────────────────────┼────────────────┼────────────────┼─────────┤');

    printCompareRow('連線時間 (ms)', avgOpenai.connectTime, avgGemini.connectTime, true);
    printCompareRow('轉錄時間 (ms)', avgOpenai.transcribeTime, avgGemini.transcribeTime, true);
    printCompareRow('翻譯時間 (ms)', avgOpenai.translateTime, avgGemini.translateTime, true);
    printCompareRow('總時間 (ms)', avgOpenai.totalTime, avgGemini.totalTime, true);
    printCompareRow('轉錄準確度 (%)', avgOpenai.accuracy, avgGemini.accuracy, false);
    printCompareRow('成功率 (%)', avgOpenai.successRate, avgGemini.successRate, false);

    console.log('└─────────────────────┴────────────────┴────────────────┴─────────┘');

    // 醫療場景建議
    console.log('\n');
    console.log('┌────────────────────────────────────────────────────────────────────────┐');
    console.log('│                        🏥 醫療場景適用性建議                           │');
    console.log('├────────────────────────────────────────────────────────────────────────┤');
    console.log('│ 項目              │ OpenAI              │ Gemini                       │');
    console.log('├───────────────────┼─────────────────────┼──────────────────────────────┤');
    console.log('│ HIPAA BAA         │ ⚠️  需與業務確認     │ ✅ 透過 Vertex AI 支援       │');
    console.log('│ 資料駐留          │ ⚠️  有限區域選擇     │ ✅ 可選擇資料中心區域        │');
    console.log('│ 醫療術語支援      │ ⚠️  透過 prompt      │ ✅ 有 Healthcare API 整合    │');
    console.log('│ API 穩定性        │ ✅ 正式版            │ ⚠️  預覽版                   │');
    console.log('│ 定價              │ 💰 較高              │ 💰 較低（免費預覽中）        │');
    console.log('└───────────────────┴─────────────────────┴──────────────────────────────┘');

    // 建議
    console.log('\n📋 建議：');
    if (avgOpenai.accuracy > avgGemini.accuracy && avgOpenai.successRate > avgGemini.successRate) {
        console.log('   ✅ OpenAI 在準確度和穩定性上表現較佳，適合正式環境');
    } else if (avgGemini.accuracy > avgOpenai.accuracy && avgGemini.successRate > avgOpenai.successRate) {
        console.log('   ✅ Gemini 在準確度和成功率上表現較佳，且成本較低');
    } else {
        console.log('   ⚖️  兩者各有優劣，建議根據具體需求選擇');
    }

    if (avgGemini.totalTime < avgOpenai.totalTime) {
        console.log('   ⚡ Gemini 延遲較低，適合對即時性要求高的場景');
    } else {
        console.log('   ⚡ OpenAI 延遲較低，適合對即時性要求高的場景');
    }

    console.log('\n   🏥 醫療正式環境建議：');
    console.log('      - 需要 HIPAA 合規：優先考慮 Gemini（透過 Vertex AI）');
    console.log('      - 需要穩定性：優先考慮 OpenAI（正式版 API）');
    console.log('      - 成本敏感：優先考慮 Gemini（目前免費預覽）');
}

function printCompareRow(label: string, openai: number, gemini: number, lowerIsBetter: boolean) {
    const winner = lowerIsBetter
        ? (openai < gemini ? 'OpenAI' : openai > gemini ? 'Gemini' : '平手')
        : (openai > gemini ? 'OpenAI' : openai < gemini ? 'Gemini' : '平手');

    const winnerIcon = winner === 'OpenAI' ? '🔵' : winner === 'Gemini' ? '🟢' : '⚖️';

    console.log(`│ ${label.padEnd(19)} │ ${openai.toFixed(1).padStart(14)} │ ${gemini.toFixed(1).padStart(14)} │ ${winnerIcon} ${winner.padEnd(5)} │`);
}

function avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// 執行測試
runFullComparison().catch(console.error);

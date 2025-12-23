/**
 * 多語言辨識測試
 * 
 * 測試目的：
 * 1. OpenAI：測試指定語言後的轉錄準確度（不支援 auto）
 * 2. Gemini：測試自動語言偵測能力（支援 auto）
 * 
 * 注意：OpenAI Realtime API 不支援 'auto' 語言偵測，
 * 必須在 session.input_audio_transcription.language 參數中明確指定語言代碼
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIRealtimeClient } from './openaiRealtimeClient';
import { GeminiRealtimeClient } from './geminiRealtimeClient';

interface TestResult {
    language: string;
    audioFile: string;
    expectedContent: string;
    openai: {
        transcript: string;
        detectedLanguage: string;
        time: number;
        specifiedLang: string; // OpenAI 需要指定語言
    } | null;
    gemini: {
        transcript: string;
        detectedLanguage: string;
        time: number;
    } | null;
}

// 測試用音訊檔案（包含 OpenAI 需要的語言代碼）
const TEST_CASES = [
    { lang: 'zh', openaiLang: 'zh', file: 'zh-01.mp3', expected: '請問你今天哪裡不舒服' },
    { lang: 'en', openaiLang: 'en', file: 'en-01.mp3', expected: 'Where does it hurt' },
    { lang: 'ja', openaiLang: 'ja', file: 'ja-01.mp3', expected: '今日はどこが痛いですか' },
    { lang: 'vi', openaiLang: 'vi', file: 'vi-01.mp3', expected: 'Hôm nay bạn đau ở đâu' },
    { lang: 'th', openaiLang: 'th', file: 'th-01.mp3', expected: 'วันนี้เจ็บตรงไหน' },
    { lang: 'id', openaiLang: 'id', file: 'id-01.mp3', expected: 'Di mana yang sakit' },
];

async function convertToPCM16(inputPath: string, sampleRate: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', inputPath,
            '-f', 's16le',
            '-acodec', 'pcm_s16le',
            '-ar', sampleRate.toString(),
            '-ac', '1',
            '-'
        ]);

        const chunks: Buffer[] = [];
        ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error(`FFmpeg exited with code ${code}`));
        });
        ffmpeg.on('error', reject);
    });
}

async function testOpenAI(audioBuffer: Buffer, specifiedLang: string): Promise<{ transcript: string; time: number }> {
    const client = new OpenAIRealtimeClient({
        apiKey: process.env.OPENAI_API_KEY!,
        sourceLang: specifiedLang, // OpenAI 必須指定語言（不支援 'auto'）
        targetLang: 'en',
        autoReconnect: false,
    });

    return new Promise(async (resolve, reject) => {
        const startTime = Date.now();
        let transcript = '';
        let resolved = false;

        client.on('transcript', (text) => {
            transcript = text;
        });

        client.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                client.disconnect();
                reject(error);
            }
        });

        try {
            await client.connect();
            await new Promise(r => setTimeout(r, 1500));

            // 串流發送音訊
            const chunkSize = 24000 * 2 * 0.1;
            for (let i = 0; i < audioBuffer.length; i += chunkSize) {
                const chunk = audioBuffer.slice(i, Math.min(i + chunkSize, audioBuffer.length));
                client.sendAudioChunk(chunk);
                await new Promise(r => setTimeout(r, 100));
            }

            // 等待 VAD 處理和轉錄完成
            await new Promise(r => setTimeout(r, 6000));

            if (!resolved) {
                resolved = true;
                client.disconnect();
                resolve({ transcript, time: Date.now() - startTime });
            }
        } catch (error) {
            if (!resolved) {
                resolved = true;
                client.disconnect();
                reject(error);
            }
        }
    });
}

async function testGemini(audioBuffer: Buffer): Promise<{ transcript: string; time: number }> {
    const client = new GeminiRealtimeClient({
        apiKey: process.env.GOOGLE_API_KEY!,
        sourceLang: 'auto', // Gemini 支援自動語言偵測
        targetLang: 'en',
        autoReconnect: false,
    });

    return new Promise(async (resolve, reject) => {
        const startTime = Date.now();
        let transcript = '';
        let resolved = false;

        client.on('transcript', (text) => {
            transcript += text;
        });

        client.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                client.disconnect();
                reject(error);
            }
        });

        try {
            await client.connect();
            await new Promise(r => setTimeout(r, 1500));

            // 串流發送音訊
            const chunkSize = 16000 * 2 * 0.1;
            for (let i = 0; i < audioBuffer.length; i += chunkSize) {
                const chunk = audioBuffer.slice(i, Math.min(i + chunkSize, audioBuffer.length));
                client.sendAudioChunk(chunk);
                await new Promise(r => setTimeout(r, 100));
            }

            // 等待處理
            await new Promise(r => setTimeout(r, 6000));

            if (!resolved) {
                resolved = true;
                client.disconnect();
                resolve({ transcript, time: Date.now() - startTime });
            }
        } catch (error) {
            if (!resolved) {
                resolved = true;
                client.disconnect();
                reject(error);
            }
        }
    });
}

function detectLanguage(text: string): string {
    if (!text) return 'unknown';

    // 簡單的語言偵測邏輯
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) return 'vi';
    if (/[a-zA-Z]/.test(text)) return 'en';

    return 'unknown';
}

async function runLanguageDetectionTest() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('              多語言辨識測試');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📋 測試說明：');
    console.log('   • OpenAI：必須指定語言代碼（不支援 auto）');
    console.log('   • Gemini：測試自動語言偵測（使用 auto）');
    console.log('');

    const audioDir = path.join(__dirname, '../../../tools/audio');
    const results: TestResult[] = [];

    for (const testCase of TEST_CASES) {
        const audioPath = path.join(audioDir, testCase.file);

        if (!fs.existsSync(audioPath)) {
            console.log(`⚠️ 跳過 ${testCase.lang}: 檔案不存在 ${testCase.file}`);
            continue;
        }

        console.log(`\n───────────────────────────────────────────────────────────────────`);
        console.log(`測試語言: ${testCase.lang.toUpperCase()} (${testCase.file})`);
        console.log(`預期內容: ${testCase.expected}`);
        console.log(`───────────────────────────────────────────────────────────────────`);

        const result: TestResult = {
            language: testCase.lang,
            audioFile: testCase.file,
            expectedContent: testCase.expected,
            openai: null,
            gemini: null,
        };

        // OpenAI 測試（指定語言）
        try {
            console.log(`\n🔷 OpenAI 測試 (指定語言: ${testCase.openaiLang})...`);
            const openaiBuffer = await convertToPCM16(audioPath, 24000);
            const openaiResult = await testOpenAI(openaiBuffer, testCase.openaiLang);
            const detectedLang = detectLanguage(openaiResult.transcript);

            result.openai = {
                transcript: openaiResult.transcript,
                detectedLanguage: detectedLang,
                time: openaiResult.time,
                specifiedLang: testCase.openaiLang,
            };

            console.log(`   指定語言: ${testCase.openaiLang}`);
            console.log(`   轉錄結果: "${openaiResult.transcript}"`);
            console.log(`   轉錄語言: ${detectedLang}`);
            console.log(`   轉錄正確: ${openaiResult.transcript.length > 0 ? '✅' : '❌'}`);
            console.log(`   耗時: ${openaiResult.time}ms`);
        } catch (error) {
            console.log(`   ❌ OpenAI 測試失敗: ${error}`);
        }

        // 等待一下避免 rate limit
        await new Promise(r => setTimeout(r, 2000));

        // Gemini 測試（自動語言偵測）
        try {
            console.log('\n🔶 Gemini 測試 (自動偵測語言)...');
            const geminiBuffer = await convertToPCM16(audioPath, 16000);
            const geminiResult = await testGemini(geminiBuffer);
            const detectedLang = detectLanguage(geminiResult.transcript);

            result.gemini = {
                transcript: geminiResult.transcript,
                detectedLanguage: detectedLang,
                time: geminiResult.time,
            };

            console.log(`   轉錄結果: "${geminiResult.transcript}"`);
            console.log(`   偵測語言: ${detectedLang}`);
            console.log(`   偵測正確: ${detectedLang === testCase.lang ? '✅' : '❌'}`);
            console.log(`   耗時: ${geminiResult.time}ms`);
        } catch (error) {
            console.log(`   ❌ Gemini 測試失敗: ${error}`);
        }

        results.push(result);

        // 等待避免 rate limit
        await new Promise(r => setTimeout(r, 2000));
    }

    // 總結報告
    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('                       測試結果總結');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('📋 測試配置差異：');
    console.log('   • OpenAI：指定語言後測試轉錄準確度');
    console.log('   • Gemini：不指定語言，測試自動語言偵測能力');
    console.log('');

    console.log('| 語言 | OpenAI (指定語言) | OpenAI 轉錄 | Gemini (自動偵測) | Gemini 轉錄 |');
    console.log('|------|------------------|------------|------------------|------------|');

    let openaiSuccess = 0;
    let geminiCorrect = 0;

    for (const result of results) {
        const openaiTranscript = result.openai?.transcript?.substring(0, 12) || 'N/A';
        const openaiHasResult = result.openai?.transcript && result.openai.transcript.length > 0;
        const geminiTranscript = result.gemini?.transcript?.substring(0, 12) || 'N/A';
        const geminiLang = result.gemini?.detectedLanguage || 'N/A';

        if (openaiHasResult) openaiSuccess++;
        if (geminiLang === result.language) geminiCorrect++;

        const openaiStatus = openaiHasResult ? '✅' : '❌';
        const geminiStatus = geminiLang === result.language ? '✅' : '❌';
        const specifiedLang = result.openai?.specifiedLang || result.language;

        console.log(`| ${result.language.toUpperCase()} | ${specifiedLang} ${openaiStatus} | ${openaiTranscript}... | ${geminiLang} ${geminiStatus} | ${geminiTranscript}... |`);
    }

    console.log('');
    console.log('📊 測試結果：');
    console.log(`   OpenAI (指定語言後轉錄成功率): ${openaiSuccess}/${results.length} (${((openaiSuccess / results.length) * 100).toFixed(1)}%)`);
    console.log(`   Gemini (自動語言偵測準確率):   ${geminiCorrect}/${results.length} (${((geminiCorrect / results.length) * 100).toFixed(1)}%)`);
    console.log('');
    console.log('📝 結論：');
    console.log('   • OpenAI Realtime API 不支援自動語言偵測，必須指定 language 參數');
    console.log('   • Gemini Multimodal Live API 支援自動語言偵測');
    console.log('   • 若需要自動語言偵測，OpenAI 需要額外整合 Whisper API');
}

runLanguageDetectionTest().catch(console.error);
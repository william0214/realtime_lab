/**
 * Google Gemini Multimodal Live API 語音診斷測試
 * 使用 FFmpeg 將 MP3 轉換為 PCM16 16kHz 格式
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiRealtimeClient } from './geminiRealtimeClient';

/**
 * 使用 FFmpeg 將音訊檔案轉換為 PCM16 16kHz mono little-endian
 */
async function convertToPCM16(inputPath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', inputPath,
            '-f', 's16le',        // PCM signed 16-bit little-endian
            '-acodec', 'pcm_s16le',
            '-ar', '16000',       // 16kHz sample rate (Gemini requirement)
            '-ac', '1',           // mono
            '-'                   // output to stdout
        ]);

        const chunks: Buffer[] = [];

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data: Buffer) => {
            // FFmpeg outputs progress to stderr, this is normal
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(Buffer.concat(chunks));
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
}

async function runDiagnostic() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('    Google Gemini Multimodal Live API 語音診斷測試');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 檢查 API Key
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ GOOGLE_API_KEY not found in environment');
        process.exit(1);
    }
    console.log('✅ API Key found');

    // 找到測試音訊檔案
    const audioDir = path.join(__dirname, '../../../tools/audio');
    const testAudioFile = path.join(audioDir, 'zh-01.mp3');

    if (!fs.existsSync(testAudioFile)) {
        console.error(`❌ 測試音訊檔案不存在: ${testAudioFile}`);
        process.exit(1);
    }
    console.log(`✅ 找到測試音訊: ${testAudioFile}`);

    // 轉換音訊
    console.log('🔄 轉換音訊為 PCM16 16kHz...');
    let pcmBuffer: Buffer;
    try {
        pcmBuffer = await convertToPCM16(testAudioFile);
        const durationMs = (pcmBuffer.length / 2 / 16000) * 1000;
        console.log(`✅ 音訊轉換完成: ${pcmBuffer.length} bytes (${durationMs.toFixed(0)}ms)`);
    } catch (error) {
        console.error('❌ 音訊轉換失敗:', error);
        process.exit(1);
    }
    console.log('');

    // 建立客戶端
    const client = new GeminiRealtimeClient({
        apiKey,
        sourceLang: 'zh-TW',
        targetLang: 'en',
        autoReconnect: false,
    });

    // 事件追蹤
    const events: { time: number; type: string; data?: string }[] = [];
    const startTime = Date.now();

    const trackEvent = (type: string, data?: string) => {
        events.push({ time: Date.now() - startTime, type, data });
        console.log(`📡 [${Date.now() - startTime}ms] ${type}${data ? ` - ${data}` : ''}`);
    };

    // 註冊事件監聽
    client.on('session_created', () => trackEvent('session_created'));
    client.on('connected', () => trackEvent('connected'));
    client.on('disconnected', (info) => trackEvent('disconnected', `code: ${info.code}`));
    client.on('error', (error) => trackEvent('error', JSON.stringify(error)));
    client.on('speech_started', () => trackEvent('speech_started'));
    client.on('speech_stopped', () => trackEvent('speech_stopped'));
    client.on('transcript', (text) => trackEvent('transcript', `"${text}"`));
    client.on('transcript_delta', (delta) => trackEvent('transcript_delta', `"${delta}"`));
    client.on('text', (text) => trackEvent('text', `"${text}"`));
    client.on('text_delta', (delta) => trackEvent('text_delta', `"${delta}"`));
    client.on('response_done', () => trackEvent('response_done'));

    try {
        // 測試 1: 連線
        console.log('───────────────────────────────────────────────────────────');
        console.log('測試 1: WebSocket 連線');
        console.log('───────────────────────────────────────────────────────────');

        const connectStart = Date.now();
        await client.connect();
        const connectTime = Date.now() - connectStart;

        console.log(`✅ 連線成功 (${connectTime}ms)`);
        console.log('');

        // 等待 session 初始化
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 測試 2: 發送真實語音
        console.log('───────────────────────────────────────────────────────────');
        console.log('測試 2: 發送真實語音 (zh-01.mp3)');
        console.log('───────────────────────────────────────────────────────────');

        // 模擬串流發送：分成 100ms 的塊發送
        const chunkSize = 16000 * 2 * 0.1; // 100ms @ 16kHz mono 16-bit = 3200 bytes
        const totalChunks = Math.ceil(pcmBuffer.length / chunkSize);

        console.log(`📤 開始串流發送 (${totalChunks} 塊, 每塊 ${chunkSize} bytes)`);

        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
            const chunk = pcmBuffer.slice(i, Math.min(i + chunkSize, pcmBuffer.length));
            client.sendAudioChunk(chunk);

            // 模擬即時串流延遲
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('✅ 音訊串流發送完成');

        // 等待處理
        console.log('⏳ 等待處理...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 嘗試手動請求回應
        console.log('📤 請求 AI 回應...');
        client.commitAudioAndRespond();

        // 等待轉錄和回應
        console.log('⏳ 等待轉錄和翻譯...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 總結
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('診斷結果');
        console.log('═══════════════════════════════════════════════════════════');

        console.log('事件流:');
        events.forEach((e, i) => {
            console.log(`  ${i + 1}. [${e.time}ms] ${e.type}${e.data ? ` - ${e.data}` : ''}`);
        });

        console.log('');
        console.log('關鍵檢查:');
        const hasConnected = events.some(e => e.type === 'connected');
        const hasSessionCreated = events.some(e => e.type === 'session_created');
        const hasSpeechStarted = events.some(e => e.type === 'speech_started');
        const hasSpeechStopped = events.some(e => e.type === 'speech_stopped');
        const hasTranscript = events.some(e => e.type === 'transcript');
        const hasText = events.some(e => e.type === 'text');
        const hasError = events.some(e => e.type === 'error');

        console.log(`  ${hasConnected ? '✅' : '❌'} connected`);
        console.log(`  ${hasSessionCreated ? '✅' : '❌'} session_created`);
        console.log(`  ${hasSpeechStarted ? '✅' : '❌'} speech_started`);
        console.log(`  ${hasSpeechStopped ? '✅' : '❌'} speech_stopped`);
        console.log(`  ${hasTranscript ? '✅' : '❌'} transcript (語音轉錄)`);
        console.log(`  ${hasText ? '✅' : '❌'} text (翻譯結果)`);
        console.log(`  ${!hasError ? '✅' : '❌'} no errors`);

        if (hasTranscript) {
            const transcriptEvent = events.find(e => e.type === 'transcript');
            console.log(`\n🎯 轉錄結果: ${transcriptEvent?.data}`);
        }

        if (hasText) {
            const textEvent = events.find(e => e.type === 'text');
            console.log(`🎯 翻譯結果: ${textEvent?.data}`);
        }

    } catch (error) {
        console.error('❌ 診斷失敗:', error);
    } finally {
        client.disconnect();
        console.log('');
        console.log('🔌 已斷開連線');
    }
}

runDiagnostic().catch(console.error);

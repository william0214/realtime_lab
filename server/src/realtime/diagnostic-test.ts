/**
 * OpenAI Realtime API 診斷測試
 * 驗證連線、事件流、音訊處理是否正常
 */

import 'dotenv/config';
import { OpenAIRealtimeClient } from './openaiRealtimeClient';

async function runDiagnostic() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('         OpenAI Realtime API 診斷測試');
    console.log('═══════════════════════════════════════════════════════════\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('❌ OPENAI_API_KEY not found in environment');
        process.exit(1);
    }

    console.log('✅ API Key found');
    console.log(`   Key prefix: ${apiKey.substring(0, 10)}...`);
    console.log('');

    // 建立客戶端
    const client = new OpenAIRealtimeClient({
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

    // 註冊所有事件監聽
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

        // 等待 session 設定完成
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 測試 2: 發送文字訊息
        console.log('───────────────────────────────────────────────────────────');
        console.log('測試 2: 發送文字訊息');
        console.log('───────────────────────────────────────────────────────────');

        const textPromise = new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Text response timeout')), 15000);
            client.once('text', (text) => {
                clearTimeout(timeout);
                resolve(text);
            });
        });

        client.sendUserMessage('請說 Hello');

        try {
            const response = await textPromise;
            console.log(`✅ 收到 AI 回應: "${response}"`);
        } catch (error) {
            console.log(`⚠️ 文字訊息測試失敗: ${error}`);
        }
        console.log('');

        // 測試 3: 發送測試音訊（正弦波）
        console.log('───────────────────────────────────────────────────────────');
        console.log('測試 3: 發送測試音訊 (440Hz 正弦波)');
        console.log('───────────────────────────────────────────────────────────');

        // 生成 1 秒的 440Hz 正弦波 @ 24kHz
        const sampleRate = 24000;
        const duration = 1;
        const frequency = 440;
        const samples = sampleRate * duration;
        const buffer = Buffer.alloc(samples * 2);

        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const value = Math.sin(2 * Math.PI * frequency * t) * 0.5 * 32767;
            buffer.writeInt16LE(Math.round(value), i * 2);
        }

        console.log(`📤 發送測試音訊: ${buffer.length} bytes (${duration}s @ ${sampleRate}Hz PCM16)`);
        client.sendAudioChunk(buffer);

        // 等待 VAD 處理
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 手動 commit
        console.log('📤 手動 commit 音訊緩衝區並請求回應');
        client.commitAudioAndRespond();

        // 等待轉錄
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 總結
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('診斷結果');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`總事件數: ${events.length}`);
        console.log('');
        console.log('事件流:');
        events.forEach((e, i) => {
            console.log(`  ${i + 1}. [${e.time}ms] ${e.type}${e.data ? ` - ${e.data}` : ''}`);
        });

        // 檢查關鍵事件
        console.log('');
        console.log('關鍵檢查:');
        const hasSessionCreated = events.some(e => e.type === 'session_created');
        const hasConnected = events.some(e => e.type === 'connected');
        const hasTranscript = events.some(e => e.type === 'transcript');
        const hasText = events.some(e => e.type === 'text');

        console.log(`  ${hasConnected ? '✅' : '❌'} connected`);
        console.log(`  ${hasSessionCreated ? '✅' : '❌'} session_created`);
        console.log(`  ${hasTranscript ? '✅' : '❌'} transcript (音訊轉錄)`);
        console.log(`  ${hasText ? '✅' : '❌'} text (AI 回應)`);

        if (!hasTranscript) {
            console.log('');
            console.log('⚠️ 音訊轉錄未觸發，可能原因：');
            console.log('   1. VAD 沒有偵測到語音（測試音訊是正弦波，不是人聲）');
            console.log('   2. 音訊格式不正確');
            console.log('   3. 音訊緩衝區沒有被 commit');
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

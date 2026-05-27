/**
 * Gemini Live 快速測試腳本
 * 使用 PCM16 16kHz 格式（Gemini Live API 要求）
 * 模型：gemini-3.1-flash-live-preview
 */
import WebSocket from 'ws';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.GEMINI_API_KEY || '';
const WS_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'gemini-3.1-flash-live-preview';

if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY 未設定');
  process.exit(1);
}

// 將 MP3 轉換為 PCM16 16kHz（Gemini Live 要求格式）
function convertToPcm16(inputPath: string): Buffer {
  const tmpPath = `/tmp/gemini-test-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return buf;
}

const audioPath = path.join(__dirname, 'audio/zh-01.mp3');
console.log(`📁 音訊檔案: ${audioPath}`);
console.log(`🤖 模型: ${MODEL}`);

const wsUrl = `${WS_ENDPOINT}?key=${API_KEY}`;
const ws = new WebSocket(wsUrl);
const startTime = Date.now();

const timeout = setTimeout(() => {
  console.log('❌ Timeout 25s — 未收到任何回應');
  ws.close();
  process.exit(1);
}, 25000);

ws.on('open', () => {
  const elapsed = Date.now() - startTime;
  console.log(`✅ WebSocket 連線成功 @${elapsed}ms`);

  // Setup 訊息：TEXT-only 輸出，無 speech_config
  const setupMsg = {
    setup: {
      model: `models/${MODEL}`,
      generation_config: {
        response_modalities: ['TEXT'],
      },
      system_instruction: {
        parts: [{
          text: 'You are a real-time transcription and translation assistant. When you receive audio, transcribe it accurately in the original language, then translate it to English. Output JSON only (no markdown): {"transcript": "...", "translation": "..."}',
        }],
      },
    },
  };

  console.log(`📤 送出 setup 訊息...`);
  ws.send(JSON.stringify(setupMsg));
});

ws.on('message', (raw: Buffer) => {
  const elapsed = Date.now() - startTime;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    console.log(`📨 @${elapsed}ms [raw]: ${raw.toString().slice(0, 100)}`);
    return;
  }

  console.log(`📨 @${elapsed}ms: ${JSON.stringify(msg).slice(0, 300)}`);

  // setupComplete → 送入 PCM16 音訊
  if (msg.setupComplete !== undefined) {
    console.log(`✅ setupComplete @${elapsed}ms — 轉換並送入 PCM16 音訊...`);
    try {
      const pcmBuf = convertToPcm16(audioPath);
      const durationSec = pcmBuf.length / (16000 * 2);
      console.log(`🎵 PCM16 大小: ${pcmBuf.length} bytes (${durationSec.toFixed(2)}s @ 16kHz)`);

      // 分塊送入（每塊 3200 bytes = 100ms @ 16kHz 16-bit mono）
      const chunkSize = 3200;
      let offset = 0;
      let chunkCount = 0;
      while (offset < pcmBuf.length) {
        const chunk = pcmBuf.slice(offset, offset + chunkSize);
        ws.send(JSON.stringify({
          realtime_input: {
            media_chunks: [{
              data: chunk.toString('base64'),
              mime_type: 'audio/pcm;rate=16000',
            }],
          },
        }));
        offset += chunkSize;
        chunkCount++;
      }
      console.log(`📤 送出 ${chunkCount} 個音訊塊 @${Date.now() - startTime}ms`);

      // 送完後發送 end-of-turn
      setTimeout(() => {
        ws.send(JSON.stringify({
          client_content: {
            turns: [{ role: 'user', parts: [{ text: '' }] }],
            turn_complete: true,
          },
        }));
        console.log(`📤 end-of-turn @${Date.now() - startTime}ms`);
      }, 300);
    } catch (err) {
      console.error('❌ 音訊轉換失敗:', err);
      clearTimeout(timeout);
      ws.close();
      process.exit(1);
    }
    return;
  }

  // serverContent → 收集轉錄/翻譯
  const sc = msg.serverContent as Record<string, unknown> | undefined;
  if (sc) {
    const mt = sc.modelTurn as Record<string, unknown> | undefined;
    if (mt) {
      const parts = mt.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const p of parts) {
          if (p.text) console.log(`💬 text @${elapsed}ms: ${p.text}`);
        }
      }
    }
    if (sc.turnComplete === true) {
      console.log(`✅ turnComplete @${elapsed}ms — 測試完成！`);
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  }

  // 錯誤處理
  if (msg.error) {
    console.error('❌ API 錯誤:', JSON.stringify(msg.error));
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (e: Error) => {
  console.error('❌ WS Error:', e.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on('close', () => {
  console.log(`🔌 WebSocket 關閉 @${Date.now() - startTime}ms`);
});

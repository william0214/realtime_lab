/**
 * Gemini Live 音訊端對端測試
 * 使用 AUDIO 輸出模式（gemini-3.1-flash-live-preview 只支援 AUDIO）
 * 送入 PCM16 16kHz 音訊，收集音訊回應和轉錄
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

if (!API_KEY) { console.error('❌ GEMINI_API_KEY 未設定'); process.exit(1); }

function convertToPcm16(inputPath: string): Buffer {
  const tmpPath = `/tmp/gemini-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return buf;
}

const audioPath = path.join(__dirname, 'audio/zh-01.mp3');
console.log(`🤖 模型: ${MODEL}`);
console.log(`📁 音訊: ${audioPath}`);

const wsUrl = `${WS_ENDPOINT}?key=${API_KEY}`;
const ws = new WebSocket(wsUrl);
const startTime = Date.now();

let firstChunkMs: number | null = null;
let turnCompleteMs: number | null = null;
let inputTranscript = '';
let outputTranscript = '';
let audioChunks = 0;

const timeout = setTimeout(() => {
  console.log('❌ Timeout 30s');
  printSummary();
  ws.close();
  process.exit(1);
}, 30000);

function printSummary() {
  console.log('\n═══════════════════════════════');
  console.log('📊 測試結果摘要');
  console.log('═══════════════════════════════');
  console.log(`首個音訊塊延遲: ${firstChunkMs ?? 'N/A'}ms`);
  console.log(`turnComplete 延遲: ${turnCompleteMs ?? 'N/A'}ms`);
  console.log(`音訊塊數量: ${audioChunks}`);
  console.log(`輸入轉錄: ${inputTranscript || '(無)'}`);
  console.log(`輸出轉錄: ${outputTranscript || '(無)'}`);
}

ws.on('open', () => {
  console.log(`✅ 連線 @${Date.now() - startTime}ms`);

  const setupMsg = {
    setup: {
      model: `models/${MODEL}`,
      generation_config: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: {
            prebuilt_voice_config: { voice_name: 'Aoede' },
          },
        },
      },
      system_instruction: {
        parts: [{
          text: [
            'You are a professional real-time simultaneous interpreter for a medical/nursing environment.',
            'When you receive Chinese (Traditional or Simplified), translate it to English immediately.',
            'When you receive English, translate it to Traditional Chinese (繁體中文) immediately.',
            'Keep the translation concise and accurate. Speak clearly at a moderate pace.',
            'Do not add any explanations or filler words.',
          ].join(' '),
        }],
      },
    },
  };

  ws.send(JSON.stringify(setupMsg));
  console.log(`📤 setup 已送出`);
});

ws.on('message', (raw: Buffer) => {
  const elapsed = Date.now() - startTime;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  // setupComplete → 送入音訊
  if (msg.setupComplete !== undefined) {
    console.log(`✅ setupComplete @${elapsed}ms — 送入 PCM16 音訊...`);
    const pcmBuf = convertToPcm16(audioPath);
    const durationSec = pcmBuf.length / (16000 * 2);
    console.log(`🎵 PCM16: ${pcmBuf.length} bytes (${durationSec.toFixed(2)}s)`);

    const chunkSize = 3200; // 100ms per chunk
    let offset = 0;
    while (offset < pcmBuf.length) {
      const chunk = pcmBuf.slice(offset, offset + chunkSize);
      ws.send(JSON.stringify({
        realtime_input: {
          audio: {
            data: chunk.toString('base64'),
            mime_type: 'audio/pcm;rate=16000',
          },
        },
      }));
      offset += chunkSize;
    }

    setTimeout(() => {
      ws.send(JSON.stringify({
        client_content: { turns: [{ role: 'user', parts: [{ text: '' }] }], turn_complete: true },
      }));
      console.log(`📤 end-of-turn @${Date.now() - startTime}ms`);
    }, 300);
    return;
  }

  // serverContent
  const sc = msg.serverContent as Record<string, unknown> | undefined;
  if (sc) {
    const mt = sc.modelTurn as Record<string, unknown> | undefined;
    if (mt) {
      const parts = mt.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const p of parts) {
          if (p.text) {
            console.log(`💬 text @${elapsed}ms: ${p.text}`);
            outputTranscript += p.text;
          }
          if (p.inlineData) {
            audioChunks++;
            if (firstChunkMs === null) {
              firstChunkMs = elapsed;
              console.log(`🔊 首個音訊塊 @${elapsed}ms`);
            }
          }
        }
      }
    }

    // 轉錄欄位（不同版本可能有不同欄位名稱）
    const it = sc.inputTranscription as Record<string, unknown> | undefined;
    if (it?.text) { inputTranscript = it.text as string; console.log(`📝 input transcript: ${it.text}`); }
    const ot = sc.outputTranscription as Record<string, unknown> | undefined;
    if (ot?.text) { outputTranscript = ot.text as string; console.log(`📝 output transcript: ${ot.text}`); }

    if (sc.turnComplete === true) {
      turnCompleteMs = elapsed;
      console.log(`✅ turnComplete @${elapsed}ms`);
      clearTimeout(timeout);
      printSummary();
      ws.close();
      process.exit(0);
    }
  }

  if (msg.error) {
    console.error(`❌ 錯誤: ${JSON.stringify(msg.error)}`);
    clearTimeout(timeout);
    printSummary();
    ws.close();
    process.exit(1);
  }
});

ws.on('close', (code: number, reason: Buffer) => {
  const r = reason.toString();
  if (r) console.log(`🔌 關閉 code=${code} reason="${r}"`);
  else console.log(`🔌 關閉 code=${code}`);
});

ws.on('error', (e: Error) => {
  console.error(`❌ WS Error: ${e.message}`);
  clearTimeout(timeout);
  process.exit(1);
});

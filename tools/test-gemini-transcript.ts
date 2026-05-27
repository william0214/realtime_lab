/**
 * 找出 Gemini Live 轉錄欄位名稱
 * dump 所有 serverContent 的完整結構
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

function convertToPcm16(inputPath: string): Buffer {
  const tmpPath = `/tmp/gemini-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return buf;
}

const audioPath = path.join(__dirname, 'audio/zh-01.mp3');
const wsUrl = `${WS_ENDPOINT}?key=${API_KEY}`;
const ws = new WebSocket(wsUrl);
const startTime = Date.now();

const timeout = setTimeout(() => { ws.close(); process.exit(1); }, 30000);

ws.on('open', () => {
  ws.send(JSON.stringify({
    setup: {
      model: `models/${MODEL}`,
      generation_config: { response_modalities: ['AUDIO'] },
      system_instruction: {
        parts: [{ text: 'Translate Chinese to English. Speak the translation.' }],
      },
    },
  }));
});

ws.on('message', (raw: Buffer) => {
  const elapsed = Date.now() - startTime;
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.setupComplete !== undefined) {
    const pcmBuf = convertToPcm16(audioPath);
    const chunkSize = 3200;
    let offset = 0;
    while (offset < pcmBuf.length) {
      const chunk = pcmBuf.slice(offset, offset + chunkSize);
      ws.send(JSON.stringify({ realtime_input: { audio: { data: chunk.toString('base64'), mime_type: 'audio/pcm;rate=16000' } } }));
      offset += chunkSize;
    }
    setTimeout(() => {
      ws.send(JSON.stringify({ client_content: { turns: [{ role: 'user', parts: [{ text: '' }] }], turn_complete: true } }));
    }, 300);
    return;
  }

  // dump serverContent 的所有頂層 key（排除 modelTurn 的 inlineData 以避免 base64 爆炸）
  const sc = msg.serverContent as Record<string, unknown> | undefined;
  if (sc) {
    const keys = Object.keys(sc);
    console.log(`📨 @${elapsed}ms serverContent keys: [${keys.join(', ')}]`);

    // 顯示非 modelTurn 的欄位
    for (const k of keys) {
      if (k !== 'modelTurn') {
        const val = sc[k];
        const str = JSON.stringify(val);
        if (str && str !== 'true' && str !== 'false' && str !== 'null') {
          console.log(`  ${k}: ${str.slice(0, 200)}`);
        } else {
          console.log(`  ${k}: ${str}`);
        }
      }
    }

    // modelTurn: 只顯示 text parts（跳過 inlineData）
    const mt = sc.modelTurn as Record<string, unknown> | undefined;
    if (mt) {
      const parts = mt.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const p of parts) {
          if (p.text) console.log(`  modelTurn.text: "${p.text}"`);
          if (p.inlineData) console.log(`  modelTurn.inlineData: [audio chunk]`);
          // 顯示其他欄位
          for (const pk of Object.keys(p)) {
            if (pk !== 'text' && pk !== 'inlineData') {
              console.log(`  modelTurn.part.${pk}: ${JSON.stringify(p[pk]).slice(0, 100)}`);
            }
          }
        }
      }
    }

    if (sc.turnComplete === true) {
      console.log(`\n✅ turnComplete @${elapsed}ms`);
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('close', (code: number, reason: Buffer) => {
  const r = reason.toString();
  if (r) console.log(`🔌 關閉 code=${code} "${r}"`);
  clearTimeout(timeout);
});
ws.on('error', (e: Error) => { console.error('❌', e.message); clearTimeout(timeout); process.exit(1); });

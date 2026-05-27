/**
 * Gemini Live 診斷腳本 v2
 * gemini-3.1-flash-live-preview 只支援 AUDIO 輸出
 * 需要同時啟用 transcription 才能取得文字
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

function convertToPcm16(inputPath: string): Buffer {
  const tmpPath = `/tmp/gemini-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  return buf;
}

const audioPath = path.join(__dirname, 'audio/zh-01.mp3');

// 嘗試不同的 AUDIO 模式 setup
const TESTS = [
  {
    name: 'Test A: AUDIO 輸出 + 轉錄設定',
    setup: {
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generation_config: {
          response_modalities: ['AUDIO'],
          output_audio_transcription: {},
          input_audio_transcription: {},
        },
        system_instruction: {
          parts: [{ text: 'You are a real-time interpreter. Translate Chinese to English and English to Chinese. Speak the translation clearly.' }],
        },
      },
    },
  },
  {
    name: 'Test B: AUDIO 輸出（無轉錄設定）',
    setup: {
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generation_config: {
          response_modalities: ['AUDIO'],
        },
        system_instruction: {
          parts: [{ text: 'Translate Chinese to English.' }],
        },
      },
    },
  },
  {
    name: 'Test C: 最簡化 AUDIO（無 system_instruction）',
    setup: {
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generation_config: {
          response_modalities: ['AUDIO'],
        },
      },
    },
  },
];

async function testSetup(testCase: typeof TESTS[0], sendAudio: boolean): Promise<void> {
  return new Promise((resolve) => {
    console.log(`\n🧪 ${testCase.name}`);
    const wsUrl = `${WS_ENDPOINT}?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);
    const startTime = Date.now();
    let audioSent = false;

    const timer = setTimeout(() => {
      console.log(`  ⏰ Timeout 12s`);
      ws.close();
      resolve();
    }, 12000);

    ws.on('open', () => {
      console.log(`  ✅ 連線 @${Date.now() - startTime}ms`);
      ws.send(JSON.stringify(testCase.setup));
      console.log(`  📤 setup 已送出`);
    });

    ws.on('message', (raw: Buffer) => {
      const elapsed = Date.now() - startTime;
      const text = raw.toString();
      try {
        const msg = JSON.parse(text) as Record<string, unknown>;

        if (msg.setupComplete !== undefined) {
          console.log(`  ✅ setupComplete @${elapsed}ms！`);
          if (sendAudio && !audioSent) {
            audioSent = true;
            try {
              const pcmBuf = convertToPcm16(audioPath);
              console.log(`  🎵 送入 PCM16 音訊 (${pcmBuf.length} bytes)...`);
              const chunkSize = 3200;
              let offset = 0;
              while (offset < pcmBuf.length) {
                const chunk = pcmBuf.slice(offset, offset + chunkSize);
                ws.send(JSON.stringify({
                  realtime_input: {
                    media_chunks: [{ data: chunk.toString('base64'), mime_type: 'audio/pcm;rate=16000' }],
                  },
                }));
                offset += chunkSize;
              }
              setTimeout(() => {
                ws.send(JSON.stringify({
                  client_content: { turns: [{ role: 'user', parts: [{ text: '' }] }], turn_complete: true },
                }));
                console.log(`  📤 end-of-turn @${Date.now() - startTime}ms`);
              }, 300);
            } catch (err) {
              console.log(`  ❌ 音訊錯誤: ${err}`);
            }
          } else {
            // 不送音訊，直接結束
            clearTimeout(timer);
            ws.close();
            resolve();
          }
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
                if (p.text) console.log(`  💬 text @${elapsed}ms: ${p.text}`);
                if (p.inlineData) console.log(`  🔊 audio chunk @${elapsed}ms`);
              }
            }
          }
          // 轉錄
          const it = sc.inputTranscription as Record<string, unknown> | undefined;
          if (it?.text) console.log(`  📝 input transcript @${elapsed}ms: ${it.text}`);
          const ot = sc.outputTranscription as Record<string, unknown> | undefined;
          if (ot?.text) console.log(`  📝 output transcript @${elapsed}ms: ${ot.text}`);

          if (sc.turnComplete === true) {
            console.log(`  ✅ turnComplete @${elapsed}ms`);
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        }

        if (msg.error) {
          console.log(`  ❌ 錯誤: ${JSON.stringify(msg.error)}`);
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch {
        console.log(`  📨 @${elapsed}ms [raw]: ${text.slice(0, 100)}`);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const elapsed = Date.now() - startTime;
      const r = reason.toString();
      if (r) {
        console.log(`  🔌 關閉 @${elapsed}ms | code=${code} reason="${r}"`);
      } else {
        console.log(`  🔌 關閉 @${elapsed}ms | code=${code}`);
      }
      clearTimeout(timer);
      resolve();
    });

    ws.on('error', (e: Error) => {
      console.log(`  ❌ WS Error: ${e.message}`);
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  if (!API_KEY) { console.error('❌ GEMINI_API_KEY 未設定'); process.exit(1); }
  console.log(`🔑 API Key: ${API_KEY.slice(0, 10)}...`);

  // Phase 1: 測試哪種 setup 能成功
  for (const test of TESTS) {
    await testSetup(test, false);
    await new Promise(r => setTimeout(r, 500));
  }

  // Phase 2: 用成功的格式送入音訊
  console.log('\n\n🎯 Phase 2: 用 Test A 格式送入音訊...');
  await testSetup({ ...TESTS[0], name: 'Test A（含音訊）' }, true);

  console.log('\n✅ 診斷完成');
}

main();

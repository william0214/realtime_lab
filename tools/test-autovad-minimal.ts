/**
 * 最小化測試：逐步找出 Automatic VAD setup 被拒絕的原因
 */
import "dotenv/config";
import WebSocket from "ws";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) { console.error("❌ 請設定 GEMINI_API_KEY"); process.exit(1); }

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

async function testSetup(name: string, setupMsg: object): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      console.log(`  [${name}] ⏰ 逾時（15s）`);
      ws.close();
      resolve();
    }, 15000);

    ws.on("open", () => {
      console.log(`  [${name}] 🔌 連接 @${Date.now() - start}ms`);
      ws.send(JSON.stringify(setupMsg));
    });

    ws.on("message", (raw: Buffer) => {
      const elapsed = Date.now() - start;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.setupComplete !== undefined) {
        console.log(`  [${name}] ✅ setupComplete @${elapsed}ms — 成功！`);
        clearTimeout(timer);
        ws.close();
        resolve();
      } else if (msg.error) {
        const err = msg.error as Record<string, unknown>;
        console.log(`  [${name}] ❌ 錯誤 @${elapsed}ms: ${err.message || JSON.stringify(err)}`);
        clearTimeout(timer);
        ws.close();
        resolve();
      } else {
        console.log(`  [${name}] 📩 訊息 @${elapsed}ms: ${JSON.stringify(msg).substring(0, 100)}`);
      }
    });

    ws.on("close", (code, reason) => {
      const elapsed = Date.now() - start;
      if (elapsed < 14000) {
        console.log(`  [${name}] 🔌 關閉 @${elapsed}ms code=${code} reason=${reason?.toString() || '無'}`);
        clearTimeout(timer);
        resolve();
      }
    });

    ws.on("error", (err: Error) => {
      console.log(`  [${name}] ❌ WS 錯誤: ${err.message}`);
      clearTimeout(timer);
      resolve();
    });
  });
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

console.log("🔬 逐步測試 Automatic VAD setup\n");

// 測試 1：最簡單的 setup（與 Manual VAD 相同，但不停用 VAD）
console.log("測試 1：基本 setup（不設定 realtime_input_config）");
await testSetup("基本", {
  setup: {
    model: `models/${GEMINI_MODEL}`,
    generation_config: {
      response_modalities: ["AUDIO"],
    },
    output_audio_transcription: {},
    system_instruction: {
      parts: [{ text: "Translate spoken Traditional Chinese to English. Medical context." }],
    },
  },
});
await sleep(2000);

// 測試 2：加入 realtime_input_config（空物件）
console.log("\n測試 2：realtime_input_config 空物件");
await testSetup("空 realtime_input_config", {
  setup: {
    model: `models/${GEMINI_MODEL}`,
    generation_config: {
      response_modalities: ["AUDIO"],
    },
    output_audio_transcription: {},
    realtime_input_config: {},
    system_instruction: {
      parts: [{ text: "Translate spoken Traditional Chinese to English. Medical context." }],
    },
  },
});
await sleep(2000);

// 測試 3：加入 automatic_activity_detection（空物件）
console.log("\n測試 3：automatic_activity_detection 空物件");
await testSetup("空 automatic_activity_detection", {
  setup: {
    model: `models/${GEMINI_MODEL}`,
    generation_config: {
      response_modalities: ["AUDIO"],
    },
    output_audio_transcription: {},
    realtime_input_config: {
      automatic_activity_detection: {},
    },
    system_instruction: {
      parts: [{ text: "Translate spoken Traditional Chinese to English. Medical context." }],
    },
  },
});
await sleep(2000);

// 測試 4：加入 silence_duration_ms
console.log("\n測試 4：silence_duration_ms: 500");
await testSetup("silence_duration_ms=500", {
  setup: {
    model: `models/${GEMINI_MODEL}`,
    generation_config: {
      response_modalities: ["AUDIO"],
    },
    output_audio_transcription: {},
    realtime_input_config: {
      automatic_activity_detection: {
        silence_duration_ms: 500,
      },
    },
    system_instruction: {
      parts: [{ text: "Translate spoken Traditional Chinese to English. Medical context." }],
    },
  },
});
await sleep(2000);

// 測試 5：用 camelCase silenceDurationMs
console.log("\n測試 5：silenceDurationMs: 500（camelCase）");
await testSetup("silenceDurationMs=500", {
  setup: {
    model: `models/${GEMINI_MODEL}`,
    generation_config: {
      response_modalities: ["AUDIO"],
    },
    output_audio_transcription: {},
    realtime_input_config: {
      automatic_activity_detection: {
        silenceDurationMs: 500,
      },
    },
    system_instruction: {
      parts: [{ text: "Translate spoken Traditional Chinese to English. Medical context." }],
    },
  },
});

console.log("\n✅ 測試完成");

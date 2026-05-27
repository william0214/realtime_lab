/**
 * test-warmpool-latency.ts
 *
 * 驗證 WarmPool 優化效果：
 * 1. 冷啟動（Cold）：每次建立新 WS 連線（模擬優化前）
 * 2. 熱啟動（Warm）：從 WarmPool 取出預建連線（模擬優化後）
 *
 * 測量指標：
 * - init → ready 時間（前端 rtw:init 到 rtw:ready 的延遲）
 */

import WebSocket from 'ws';
import { WarmPool } from '../server/src/services/realtimeWhisperProxy';

const API_KEY = process.env.OPENAI_API_KEY || '';
const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

function makeSessionUpdatePayload(language: string) {
  return JSON.stringify({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: 'gpt-realtime-whisper',
            language,
            delay: 'low',
          },
        },
      },
    },
  });
}

/**
 * 冷啟動：建立新 WS 連線並等待 session.updated
 */
function coldConnect(language: string): Promise<{ ws: WebSocket; elapsed: number }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(REALTIME_WS_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Cold connect timeout'));
    }, 15000);

    ws.on('open', () => {
      ws.send(makeSessionUpdatePayload(language));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'session.updated') {
          clearTimeout(timeout);
          resolve({ ws, elapsed: Date.now() - t0 });
        } else if (event.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error((event.error as { message?: string })?.message || 'API error'));
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log('=== WarmPool 延遲優化驗證測試 ===\n');

  // ─── 1. 冷啟動測試（3 次）────────────────────────────────────────────────
  console.log('【冷啟動測試（Cold Start）】');
  console.log('模擬優化前：每次使用者按下錄音按鈕時建立新連線\n');

  const coldTimes: number[] = [];
  const coldWss: WebSocket[] = [];

  for (let i = 1; i <= 3; i++) {
    try {
      const { ws, elapsed } = await coldConnect('zh');
      coldTimes.push(elapsed);
      coldWss.push(ws);
      console.log(`  Cold Run ${i}: ${elapsed}ms`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`  Cold Run ${i} failed:`, (e as Error).message);
    }
  }

  // 關閉冷啟動連線
  coldWss.forEach(ws => ws.close(1000, 'test done'));

  const coldAvg = coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length;
  console.log(`\n  平均冷啟動延遲: ${coldAvg.toFixed(0)}ms`);

  // ─── 2. 熱啟動測試（WarmPool）─────────────────────────────────────────────
  console.log('\n【熱啟動測試（Warm Start / WarmPool）】');
  console.log('模擬優化後：從預建連線池取出已就緒的連線\n');

  // 建立 WarmPool（poolSize=3，預建 3 條連線）
  const pool = new WarmPool({
    apiKey: API_KEY,
    defaultLanguage: 'zh',
    poolSize: 3,
    maxIdleMs: 120_000,
  });

  console.log('  正在預建連線池...');
  const poolStartT = Date.now();
  await pool.start();
  const poolReadyMs = Date.now() - poolStartT;
  console.log(`  WarmPool 就緒（${pool.size} 條連線，耗時 ${poolReadyMs}ms）\n`);

  // 等待 500ms 確保 pool 穩定
  await new Promise(r => setTimeout(r, 500));

  const warmTimes: number[] = [];
  const warmWss: WebSocket[] = [];

  for (let i = 1; i <= 3; i++) {
    try {
      const t0 = Date.now();
      const ws = await pool.acquire('zh');
      const elapsed = Date.now() - t0;
      warmTimes.push(elapsed);
      warmWss.push(ws);
      console.log(`  Warm Run ${i}: ${elapsed}ms (pool remaining: ${pool.size})`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`  Warm Run ${i} failed:`, (e as Error).message);
    }
  }

  // 關閉熱啟動連線
  warmWss.forEach(ws => ws.close(1000, 'test done'));
  pool.stop();

  const warmAvg = warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length;
  console.log(`\n  平均熱啟動延遲: ${warmAvg.toFixed(0)}ms`);

  // ─── 3. 結果摘要 ──────────────────────────────────────────────────────────
  const improvement = coldAvg - warmAvg;
  const improvementPct = ((improvement / coldAvg) * 100).toFixed(1);

  console.log('\n=== 結果摘要 ===\n');
  console.log(`  冷啟動（優化前）: ${coldAvg.toFixed(0)}ms`);
  console.log(`  熱啟動（優化後）: ${warmAvg.toFixed(0)}ms`);
  console.log(`  節省延遲:         ${improvement.toFixed(0)}ms（${improvementPct}%）`);
  console.log(`\n  WarmPool 預建成本: ${poolReadyMs}ms（伺服器啟動時一次性付出）`);
  console.log(`  回收時間:          ${(poolReadyMs / improvement).toFixed(1)} 次請求後回收`);

  console.log('\n=== 實際使用者體驗預估 ===\n');
  const beforeTotal = coldAvg + 1217; // 冷啟動 + ASR 推理
  const afterTotal = warmAvg + 1217;  // 熱啟動 + ASR 推理
  console.log(`  優化前（按下錄音 → 首字字幕）: ~${beforeTotal.toFixed(0)}ms`);
  console.log(`  優化後（按下錄音 → 首字字幕）: ~${afterTotal.toFixed(0)}ms`);
  console.log(`  使用者感受到的延遲改善: ${(beforeTotal - afterTotal).toFixed(0)}ms`);

  process.exit(0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

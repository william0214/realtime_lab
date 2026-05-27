import WebSocket from 'ws';

const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const API_KEY = process.env.OPENAI_API_KEY || '';

async function measureWsConnection(label: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(REALTIME_WS_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout'));
    }, 15000);
    ws.on('open', () => {
      const elapsed = Date.now() - t0;
      console.log(`[${label}] WS open: ${elapsed}ms`);
      clearTimeout(timeout);
      ws.close();
      resolve(elapsed);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log('=== WebSocket 連線時間測試（5 次）===\n');
  const times: number[] = [];
  for (let i = 1; i <= 5; i++) {
    try {
      const ms = await measureWsConnection(`Run ${i}`);
      times.push(ms);
      await new Promise(r => setTimeout(r, 500)); // 間隔 500ms
    } catch (e) {
      console.error(`Run ${i} failed:`, e);
    }
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`\n=== 統計 ===`);
  console.log(`平均: ${avg.toFixed(0)}ms | 最低: ${min}ms | 最高: ${max}ms`);
  console.log(`\n分析：`);
  console.log(`- curl TLS 握手: ~70ms（HTTP/2）`);
  console.log(`- WS 升級額外開銷: ${(avg - 70).toFixed(0)}ms（HTTP Upgrade 往返）`);
}

main().catch(console.error);

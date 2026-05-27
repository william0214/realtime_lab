/**
 * test-ga-realtime2.ts
 * 測試 gpt-realtime-2 GA API 是否支援翻譯模式的 session.update 格式
 */
import WebSocket from 'ws';

const API_KEY = process.env.OPENAI_API_KEY || '';
const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2';

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

const timeout = setTimeout(() => {
  console.log('❌ Timeout');
  ws.close();
  process.exit(1);
}, 12000);

ws.on('open', () => {
  console.log('✅ Connected to gpt-realtime-2');
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: 'You are a real-time translator. Translate Chinese speech to English text. Output only the English translation.',
    },
  }));
  console.log('📤 session.update sent');
});

ws.on('message', (data: WebSocket.Data) => {
  const event = JSON.parse(data.toString()) as { type: string; error?: { message: string }; session?: unknown };
  console.log(`📥 Event: ${event.type}`);
  if (event.type === 'session.updated') {
    console.log('✅ session.updated — gpt-realtime-2 支援翻譯模式格式！');
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  }
  if (event.type === 'error') {
    console.log(`❌ Error: ${event.error?.message}`);
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (e: Error) => {
  console.error('WS Error:', e.message);
  clearTimeout(timeout);
  process.exit(1);
});

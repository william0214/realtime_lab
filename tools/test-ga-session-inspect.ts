import WebSocket from 'ws';

const API_KEY = process.env.OPENAI_API_KEY || '';
const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2';

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

const timeout = setTimeout(() => { ws.close(); process.exit(0); }, 10000);

ws.on('open', () => {
  console.log('✅ Connected');
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: 'You are a real-time translator. Translate Chinese speech to English.',
    },
  }));
});

ws.on('message', (data: WebSocket.Data) => {
  const event = JSON.parse(data.toString()) as { type: string; session?: unknown; error?: { message: string } };
  if (event.type === 'session.created' || event.type === 'session.updated') {
    console.log(`\n=== ${event.type} ===`);
    console.log(JSON.stringify(event.session, null, 2));
    if (event.type === 'session.updated') {
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  }
  if (event.type === 'error') {
    console.log('❌ Error:', event.error?.message);
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (e: Error) => { console.error('WS Error:', e.message); process.exit(1); });

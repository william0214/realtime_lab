/**
 * test-warmpool-e2e.ts
 *
 * WarmPool 端對端測試：
 * 1. 連接 /rtw Socket.IO 命名空間
 * 2. 計時 rtw:init → rtw:ready（驗證 WarmPool 效果）
 * 3. 傳送真實音訊，驗證 rtw:delta 和 rtw:final
 * 4. 輸出完整延遲分解報告
 */

import { io as SocketIO } from 'socket.io-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = 'http://localhost:3001';
const AUDIO_FILE = path.join(__dirname, 'audio/zh-01.mp3');

// 動態 import ffmpeg（用於 MP3 → PCM16 轉換）
async function convertMp3ToPcm16(filePath: string): Promise<Buffer> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const tmpFile = `/tmp/test_pcm_${Date.now()}.raw`;
  await execAsync(
    `ffmpeg -y -i "${filePath}" -ar 24000 -ac 1 -f s16le "${tmpFile}" 2>/dev/null`
  );
  const buf = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return buf;
}

async function runTest(testName: string, serverUrl: string): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`【${testName}】`);
  console.log(`${'─'.repeat(50)}`);

  return new Promise((resolve, reject) => {
    const timings: Record<string, number> = {};
    const t0 = Date.now();

    const socket = SocketIO(`${serverUrl}/rtw`, {
      transports: ['websocket'],
      timeout: 15000,
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Test timeout after 30s'));
    }, 30000);

    // ── 連線建立 ──────────────────────────────────────────────────────────
    socket.on('connect', () => {
      timings.connected = Date.now() - t0;
      console.log(`  ✅ Socket.IO connected: ${timings.connected}ms`);

      // 發送 rtw:init
      timings.initSent = Date.now() - t0;
      socket.emit('rtw:init', { language: 'zh' });
      console.log(`  📤 rtw:init sent: ${timings.initSent}ms`);
    });

    // ── RTW Ready（WarmPool 效果驗證）────────────────────────────────────
    socket.on('rtw:ready', async () => {
      timings.ready = Date.now() - t0;
      const initToReady = timings.ready - timings.initSent;
      console.log(`  🔥 rtw:ready: ${timings.ready}ms (init→ready: ${initToReady}ms)`);

      if (initToReady < 100) {
        console.log(`  ✅ WarmPool 生效！init→ready 僅 ${initToReady}ms（優化前 ~985ms）`);
      } else {
        console.log(`  ⚠️  WarmPool 未生效，init→ready = ${initToReady}ms（可能是冷啟動）`);
      }

      // 轉換音訊並傳送
      try {
        console.log(`  🎵 Converting audio...`);
        const pcmBuffer = await convertMp3ToPcm16(AUDIO_FILE);
        console.log(`  📦 PCM16 size: ${pcmBuffer.length} bytes (${(pcmBuffer.length / 48000).toFixed(1)}s @ 24kHz)`);

        // 分塊傳送（每塊 4800 bytes = 100ms @ 24kHz 16-bit mono）
        const chunkSize = 4800;
        let offset = 0;
        timings.audioStart = Date.now() - t0;

        while (offset < pcmBuffer.length) {
          const chunk = pcmBuffer.slice(offset, offset + chunkSize);
          socket.emit('rtw:audio', chunk);
          offset += chunkSize;
          await new Promise(r => setTimeout(r, 50)); // 模擬 50ms 間隔
        }

        timings.audioEnd = Date.now() - t0;
        console.log(`  📤 Audio sent: ${timings.audioEnd}ms (duration: ${timings.audioEnd - timings.audioStart}ms)`);

        // 手動 commit
        socket.emit('rtw:commit');
        timings.committed = Date.now() - t0;
        console.log(`  📤 rtw:commit sent: ${timings.committed}ms`);
      } catch (e) {
        console.error(`  ❌ Audio conversion failed:`, e);
        clearTimeout(timeout);
        socket.disconnect();
        reject(e);
      }
    });

    // ── RTW Delta（即時字幕）─────────────────────────────────────────────
    let deltaCount = 0;
    let accumulatedText = '';

    socket.on('rtw:delta', (data: { delta: string }) => {
      if (deltaCount === 0) {
        timings.firstDelta = Date.now() - t0;
        console.log(`  💬 First rtw:delta: ${timings.firstDelta}ms`);
      }
      deltaCount++;
      accumulatedText += data.delta;
    });

    // ── RTW Final（最終轉錄）─────────────────────────────────────────────
    socket.on('rtw:final', (data: { transcript: string }) => {
      timings.final = Date.now() - t0;
      console.log(`  ✅ rtw:final: ${timings.final}ms`);
      console.log(`  📝 Transcript: "${data.transcript}"`);
      console.log(`  📊 Delta count: ${deltaCount}`);

      // 計算關鍵延遲
      console.log(`\n  === 延遲分解 ===`);
      console.log(`  Socket.IO 連線:    ${timings.connected}ms`);
      console.log(`  init → ready:      ${timings.ready - timings.initSent}ms  ← WarmPool 效果`);
      console.log(`  音訊傳送:          ${timings.audioEnd - timings.audioStart}ms`);
      if (timings.firstDelta) {
        console.log(`  ready → 首字:      ${timings.firstDelta - timings.ready}ms`);
      }
      console.log(`  ready → final:     ${timings.final - timings.ready}ms`);
      console.log(`  total (T0→final):  ${timings.final}ms`);

      clearTimeout(timeout);
      socket.disconnect();
      resolve();
    });

    // ── RTW Speech Stopped ────────────────────────────────────────────────
    socket.on('rtw:speech_stopped', () => {
      timings.speechStopped = Date.now() - t0;
      console.log(`  🔇 rtw:speech_stopped: ${timings.speechStopped}ms`);
    });

    // ── 錯誤處理 ─────────────────────────────────────────────────────────
    socket.on('rtw:error', (data: { error: string }) => {
      console.error(`  ❌ rtw:error: ${data.error}`);
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(data.error));
    });

    socket.on('connect_error', (err) => {
      console.error(`  ❌ Connection error: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log('=== WarmPool 端對端測試 ===');
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Audio: ${AUDIO_FILE}`);

  // 確認音訊檔案存在
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`❌ Audio file not found: ${AUDIO_FILE}`);
    process.exit(1);
  }

  // 測試 1：第一次請求（pool 應已就緒）
  await runTest('測試 1：WarmPool 熱啟動（第一次請求）', SERVER_URL);

  await new Promise(r => setTimeout(r, 1000));

  // 測試 2：第二次請求（pool 應已補充）
  await runTest('測試 2：WarmPool 熱啟動（第二次請求）', SERVER_URL);

  console.log('\n=== 測試完成 ===');
  process.exit(0);
}

main().catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});

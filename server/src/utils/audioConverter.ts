import { spawn } from 'child_process';

// 累積 webm 資料的 buffer（因為瀏覽器發送的是片段）
let webmBuffer: Buffer[] = [];
let isFirstChunk = true;
let lastConvertedLength = 0; // 記錄上次轉換到的 webm 位置
let lastPcmLength = 0; // 記錄上次發送的 PCM 長度（避免重複發送）

// 動態取樣率設定（根據 provider 調整）
let targetSampleRate = 24000; // 預設 OpenAI: 24kHz

/**
 * 設定目標取樣率
 * OpenAI: 24000 (24kHz)
 * Gemini: 16000 (16kHz)
 */
export function setTargetSampleRate(sampleRate: number): void {
    targetSampleRate = sampleRate;
    console.log(`🎵 Audio sample rate set to: ${sampleRate}Hz`);
}

/**
 * 取得目前取樣率
 */
export function getTargetSampleRate(): number {
    return targetSampleRate;
}

/**
 * 重置累積的音訊資料
 */
export function resetAudioBuffer(): void {
    webmBuffer = [];
    isFirstChunk = true;
    lastConvertedLength = 0;
    lastPcmLength = 0;
    console.log('🔄 Audio buffer reset');
}

/**
 * 累積 webm 片段
 */
export function appendAudioChunk(chunk: ArrayBuffer): void {
    const buffer = Buffer.from(chunk);

    // 檢查是否為有效的 webm EBML header（應該以 1a45dfa3 開頭）
    if (isFirstChunk) {
        const header = buffer.slice(0, 4).toString('hex');
        // 有效的 EBML header 開頭
        if (header === '1a45dfa3') {
            console.log(`🔄 Valid EBML header detected`);
        } else {
            console.log(`⚠️ First chunk header: ${buffer.slice(0, 20).toString('hex')}`);
            console.log(`⚠️ This may not be a valid webm start - waiting for valid header`);
            // 如果不是有效 header，跳過這個 chunk
            return;
        }
        isFirstChunk = false;
    }

    webmBuffer.push(buffer);
}

/**
 * 取得目前累積的資料總長度
 */
export function getAccumulatedLength(): number {
    return webmBuffer.reduce((acc, buf) => acc + buf.length, 0);
}

/**
 * 檢查是否有足夠新資料需要轉換（至少累積一定量才轉換）
 */
export function hasEnoughNewData(minBytes: number = 5000): boolean {
    const totalLength = getAccumulatedLength();
    return totalLength - lastConvertedLength >= minBytes;
}

/**
 * 將目前累積的完整 webm 轉換為 PCM16，只回傳「新增」的部分
 * 避免重複發送已經發送過的音訊
 */
export async function convertAccumulatedIncrementally(): Promise<Buffer | null> {
    if (webmBuffer.length === 0) {
        return null;
    }

    const inputData = Buffer.concat(webmBuffer);

    // 如果資料量太小，可能無法解碼
    if (inputData.length < 1000) {
        return null;
    }

    // 如果沒有新資料，不轉換
    if (inputData.length <= lastConvertedLength) {
        return null;
    }

    console.log(`🔄 Converting incrementally: ${inputData.length} bytes (last webm: ${lastConvertedLength})`);

    try {
        const fullPcm = await convertToPCM16(inputData);

        // 只回傳新增的 PCM 部分（避免重複發送）
        let newPcm: Buffer;
        if (lastPcmLength > 0 && lastPcmLength < fullPcm.length) {
            newPcm = fullPcm.slice(lastPcmLength);
            console.log(`📤 New PCM only: ${newPcm.length} bytes (skipped first ${lastPcmLength})`);
        } else {
            newPcm = fullPcm;
            console.log(`📤 First PCM batch: ${newPcm.length} bytes`);
        }

        // 更新追蹤的長度
        lastConvertedLength = inputData.length;
        lastPcmLength = fullPcm.length;

        return newPcm;
    } catch (error) {
        console.error('🚨 Incremental conversion failed:', error);
        return null;
    }
}

/**
 * 取得累積的完整 webm 資料並轉換為 PCM16（用於最終提交）
 * 只回傳尚未發送的部分
 */
export async function convertAccumulatedToPCM16(): Promise<Buffer> {
    if (webmBuffer.length === 0) {
        throw new Error('No audio data accumulated');
    }

    const inputData = Buffer.concat(webmBuffer);
    console.log(`🔄 Converting final: ${inputData.length} bytes`);

    try {
        const fullPcm = await convertToPCM16(inputData);

        // 只回傳新增的部分
        let newPcm: Buffer;
        if (lastPcmLength > 0 && lastPcmLength < fullPcm.length) {
            newPcm = fullPcm.slice(lastPcmLength);
            console.log(`📤 Final new PCM: ${newPcm.length} bytes`);
        } else if (lastPcmLength >= fullPcm.length) {
            console.log(`📤 No new PCM to send (already sent ${lastPcmLength} bytes)`);
            newPcm = Buffer.alloc(0);
        } else {
            newPcm = fullPcm;
        }

        // 重置所有狀態
        webmBuffer = [];
        isFirstChunk = true;
        lastConvertedLength = 0;
        lastPcmLength = 0;

        return newPcm;
    } catch (error) {
        // 發生錯誤時也重置
        webmBuffer = [];
        isFirstChunk = true;
        lastConvertedLength = 0;
        lastPcmLength = 0;
        throw error;
    }
}

/**
 * 使用 ffmpeg 將音訊轉換為 PCM16 格式
 * OpenAI Realtime API 需要 PCM16, 24kHz, mono
 * Gemini Live API 需要 PCM16, 16kHz, mono
 */
export async function convertToPCM16(inputBuffer: ArrayBuffer | Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const inputData = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer);

        console.log(`🔄 Converting audio: ${inputData.length} bytes, target: ${targetSampleRate}Hz, first bytes: ${inputData.slice(0, 20).toString('hex')}`);

        // 使用 ffmpeg 轉換
        // 輸入: webm/opus (瀏覽器 MediaRecorder 預設格式)
        // 輸出: PCM16, 動態取樣率, mono, little-endian
        const ffmpeg = spawn('ffmpeg', [
            '-f', 'webm',             // 指定輸入格式為 webm
            '-i', 'pipe:0',           // 從 stdin 讀取
            '-f', 's16le',            // 輸出格式: signed 16-bit little-endian
            '-acodec', 'pcm_s16le',   // 編碼: PCM 16-bit
            '-ar', targetSampleRate.toString(), // 取樣率: 動態設定
            '-ac', '1',               // 聲道: mono
            'pipe:1'                  // 輸出到 stdout
        ], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const chunks: Buffer[] = [];
        let stderrOutput = '';

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data: Buffer) => {
            stderrOutput += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                const outputBuffer = Buffer.concat(chunks);
                console.log(`✅ Converted audio: ${inputData.length} bytes -> ${outputBuffer.length} bytes (PCM16)`);
                resolve(outputBuffer);
            } else {
                console.error(`🚨 ffmpeg failed with code ${code}`);
                console.error(`🚨 ffmpeg stderr: ${stderrOutput}`);
                reject(new Error(`ffmpeg exited with code ${code}: ${stderrOutput.slice(-500)}`));
            }
        });

        ffmpeg.on('error', (error) => {
            console.error(`🚨 ffmpeg spawn error:`, error);
            reject(error);
        });

        // 寫入輸入資料
        ffmpeg.stdin.write(inputData);
        ffmpeg.stdin.end();
    });
}

/**
 * 檢查 ffmpeg 是否可用
 */
export async function checkFFmpeg(): Promise<boolean> {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version']);

        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });

        ffmpeg.on('error', () => {
            resolve(false);
        });
    });
}

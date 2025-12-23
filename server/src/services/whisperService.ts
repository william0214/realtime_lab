// server/src/services/whisperService.ts
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * 使用 Whisper 對完整錄音做一次轉錄
 * 傳進來的是累積好的 webm buffer（尚未經過 ffmpeg 轉 PCM）
 */
export async function transcribeWithWhisper(webmBuffer: Buffer): Promise<string> {
    if (!webmBuffer || webmBuffer.length === 0) {
        return '';
    }

    try {
        const res = await openai.audio.transcriptions.create({
            // JS SDK 支援 Buffer / Uint8Array / Blob / File / ReadStream
            file: webmBuffer,
            model: 'whisper-1',
            // 這裡可以指定語言，例如：
            // language: 'zh',
        });

        return res.text || '';
    } catch (error) {
        console.error('🚨 Whisper transcription error:', error);
        return '';
    }
}

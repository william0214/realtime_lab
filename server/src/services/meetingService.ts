/**
 * meetingService.ts — 會議記錄累積與結構化摘要生成
 *
 * Step 11：儲存完整逐字稿（speaker + sourceText + translatedText + timestamp）
 * Step 12：使用 Gemini REST API（非 Live）生成結構化摘要
 */

import { type DomainCode, getDomainConfig } from './domainService';

// ============ 型別 ============

export interface Utterance {
    id: string;
    timestamp: string;
    speaker: 'source' | 'target';    // 'source' = 本地說話者(mic), 'target' = 遠端說話者(system)
    speakerLabel: string;             // 依領域動態標籤，例如「醫生」、「病人」
    sourceText: string;               // ASR 原文
    translatedText: string;           // 翻譯結果
    sourceLang: string;
    targetLang: string;
    isReverse: boolean;               // 是否為反向翻譯
    confidence?: 'high' | 'medium' | 'low';
}

export interface MeetingSummary {
    summary: string;              // 整體摘要（2-4 句）
    keyPoints: string[];          // 重點列表
    actionItems: string[];        // 行動項目（若有）
    duration: number;             // 會議時長（秒）
    utteranceCount: number;       // 發言總次數
    domain: DomainCode;
    generatedAt: string;
}

export interface MeetingRecord {
    id: string;
    domain: DomainCode;
    startedAt: string;
    endedAt?: string;
    utterances: Utterance[];
    summary?: MeetingSummary;
}

// ============ 服務類別 ============

export class MeetingService {
    private meetings = new Map<string, MeetingRecord>();
    private geminiApiKey: string;

    constructor(geminiApiKey: string) {
        this.geminiApiKey = geminiApiKey;
    }

    // ---- Step 11：會議記錄累積 ----

    /** 開始新的會議，回傳 meetingId */
    startMeeting(domain: DomainCode): string {
        const id = `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record: MeetingRecord = {
            id,
            domain,
            startedAt: new Date().toISOString(),
            utterances: [],
        };
        this.meetings.set(id, record);
        console.log(`📋 Meeting started: ${id} [${domain}]`);
        return id;
    }

    /** 加入一條發言記錄 */
    addUtterance(
        meetingId: string,
        data: Omit<Utterance, 'id' | 'timestamp' | 'speakerLabel'>
    ): Utterance | null {
        const record = this.meetings.get(meetingId);
        if (!record) return null;

        const domainConfig = getDomainConfig(record.domain);
        const speakerLabel = data.speaker === 'source'
            ? domainConfig.speakerLabels.source
            : domainConfig.speakerLabels.target;

        const utterance: Utterance = {
            id: `utt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            timestamp: new Date().toISOString(),
            speakerLabel,
            ...data,
        };

        record.utterances.push(utterance);
        return utterance;
    }

    /** 取得完整逐字稿 */
    getMeetingTranscript(meetingId: string): MeetingRecord | null {
        return this.meetings.get(meetingId) ?? null;
    }

    /** 結束會議（不生成摘要） */
    endMeeting(meetingId: string): MeetingRecord | null {
        const record = this.meetings.get(meetingId);
        if (!record) return null;
        record.endedAt = new Date().toISOString();
        console.log(`📋 Meeting ended: ${meetingId} (${record.utterances.length} utterances)`);
        return record;
    }

    // ---- Step 12：摘要生成 ----

    /** 使用 Gemini REST API 生成結構化摘要 */
    async generateSummary(meetingId: string): Promise<MeetingSummary | null> {
        const record = this.meetings.get(meetingId);
        if (!record || record.utterances.length === 0) return null;

        const domainConfig = getDomainConfig(record.domain);
        const startTime = new Date(record.startedAt).getTime();
        const endTime = record.endedAt ? new Date(record.endedAt).getTime() : Date.now();
        const durationSec = Math.round((endTime - startTime) / 1000);

        // 建立逐字稿文字（中英混合，依領域標籤標示說話者）
        const transcriptText = record.utterances
            .map(u => `[${u.speakerLabel}] ${u.sourceText}（翻譯：${u.translatedText}）`)
            .join('\n');

        const prompt = `你是一位專業的${domainConfig.name}領域會議記錄員。

以下是一場${domainConfig.name}會議的逐字稿（共 ${record.utterances.length} 條發言，時長約 ${Math.round(durationSec / 60)} 分鐘）：

${transcriptText}

請根據上述逐字稿，以繁體中文生成結構化摘要，輸出 JSON 格式：
{
  "summary": "整體摘要（2-4 句，說明主要討論內容與結果）",
  "keyPoints": ["重點1", "重點2", ...],
  "actionItems": ["行動項目1", "行動項目2"] (若無則為空陣列)
}

注意：
- 數字、日期、劑量必須與逐字稿完全一致，不得改寫
- 不要添加逐字稿中沒有的資訊
- 只輸出 JSON，不要其他文字`;

        try {
            const response = await this.callGeminiRest(prompt);
            const parsed = JSON.parse(response);

            const summary: MeetingSummary = {
                summary: parsed.summary ?? '',
                keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
                actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
                duration: durationSec,
                utteranceCount: record.utterances.length,
                domain: record.domain,
                generatedAt: new Date().toISOString(),
            };

            record.summary = summary;
            console.log(`📝 Summary generated for ${meetingId}`);
            return summary;

        } catch (err) {
            console.error(`❌ Summary generation failed: ${(err as Error).message}`);
            return null;
        }
    }

    // ---- 私有方法 ----

    /** 呼叫 Gemini REST API（非 Live）*/
    private async callGeminiRest(prompt: string): Promise<string> {
        const model = process.env.GEMINI_SUMMARY_MODEL ?? 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2,
            },
        });

        const { default: https } = await import('https');

        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const req = https.request(
                {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                },
                res => {
                    const chunks: Buffer[] = [];
                    res.on('data', (d: Buffer) => chunks.push(d));
                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf-8');
                        try {
                            const parsed = JSON.parse(raw);
                            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                            if (!text) throw new Error(`Empty response: ${raw.slice(0, 200)}`);
                            resolve(text);
                        } catch (e) {
                            reject(new Error(`Gemini parse error: ${(e as Error).message}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Gemini REST timeout')); });
            req.write(body);
            req.end();
        });
    }

    /** 清理舊會議記錄（超過 maxAge 毫秒） */
    cleanup(maxAgeMs = 24 * 60 * 60 * 1000): number {
        const cutoff = Date.now() - maxAgeMs;
        let removed = 0;
        for (const [id, record] of this.meetings.entries()) {
            if (new Date(record.startedAt).getTime() < cutoff) {
                this.meetings.delete(id);
                removed++;
            }
        }
        return removed;
    }
}

// ============ Singleton ============

let _instance: MeetingService | null = null;

export function getMeetingService(): MeetingService {
    if (!_instance) {
        const apiKey = process.env.GEMINI_API_KEY ?? '';
        _instance = new MeetingService(apiKey);
    }
    return _instance;
}

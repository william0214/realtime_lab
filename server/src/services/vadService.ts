/**
 * VAD (Voice Activity Detection) 語音活動偵測服務
 * 用於過濾背景雜音，只處理有人聲的音訊
 */

export interface VADConfig {
    energyThreshold: number;    // 能量閾值（0-1）
    silenceFrameCount: number;  // 靜音幀數閾值
    speechFrameCount: number;   // 語音幀數閾值
}

const DEFAULT_CONFIG: VADConfig = {
    energyThreshold: 0.015,
    silenceFrameCount: 8,
    speechFrameCount: 2,
};

export class VADService {
    private config: VADConfig;
    private silenceCount = 0;
    private speechCount = 0;
    private speaking = false;

    constructor(config: Partial<VADConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 計算音訊能量 (RMS)
     */
    computeEnergy(pcmData: Buffer): number {
        if (!pcmData || pcmData.length < 2) return 0;

        let squareSum = 0;
        const sampleCount = Math.floor(pcmData.length / 2);

        for (let i = 0; i < pcmData.length - 1; i += 2) {
            const sample = pcmData.readInt16LE(i);
            squareSum += sample * sample;
        }

        const rms = Math.sqrt(squareSum / sampleCount);
        return rms / 32768; // 正規化到 0-1
    }

    /**
     * 偵測是否有語音活動
     */
    isSpeechDetected(pcmData: Buffer): boolean {
        const energy = this.computeEnergy(pcmData);
        const aboveThreshold = energy > this.config.energyThreshold;

        if (aboveThreshold) {
            this.speechCount++;
            this.silenceCount = 0;
            if (this.speechCount >= this.config.speechFrameCount) {
                this.speaking = true;
            }
        } else {
            this.silenceCount++;
            this.speechCount = 0;
            if (this.silenceCount >= this.config.silenceFrameCount) {
                this.speaking = false;
            }
        }

        return this.speaking;
    }

    /**
     * 取得偵測資訊
     */
    getStatus(pcmData: Buffer): { energy: number; speaking: boolean } {
        return {
            energy: this.computeEnergy(pcmData),
            speaking: this.speaking,
        };
    }

    /**
     * 重置狀態
     */
    reset(): void {
        this.silenceCount = 0;
        this.speechCount = 0;
        this.speaking = false;
    }

    /**
     * 更新設定
     */
    updateConfig(config: Partial<VADConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 取得目前設定
     */
    getConfig(): VADConfig {
        return { ...this.config };
    }
}

let instance: VADService | null = null;

export function getVADService(config?: Partial<VADConfig>): VADService {
    if (!instance) {
        instance = new VADService(config);
    }
    return instance;
}

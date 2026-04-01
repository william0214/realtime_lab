/**
 * 專業領域配置服務
 *
 * 定義所有支援的專業領域，包含名稱、角色標籤、prompt 片段、安全規則等。
 */

// 領域代碼
export type DomainCode = 'medical' | 'legal' | 'finance' | 'tech' | 'business' | 'aviation' | 'general';

// 領域配置
export interface DomainConfig {
    code: DomainCode;
    name: string;          // 中文名稱
    nameEn: string;        // 英文名稱
    icon: string;          // 顯示用 emoji
    speakerLabels: {
        source: string;    // 來源端標籤（如「醫生」「律師」）
        target: string;    // 目標端標籤（如「病人」「當事人」）
    };
    /** 注入到翻譯 prompt 的領域上下文描述 */
    promptFragment: string;
    /** 通用安全規則（所有領域共用） + 領域補充提示 */
    safetyHint: string;
}

// ============ 領域定義 ============

const DOMAIN_CONFIGS: Record<DomainCode, DomainConfig> = {
    medical: {
        code: 'medical',
        name: '醫療',
        nameEn: 'Medical',
        icon: '🏥',
        speakerLabels: { source: '醫護人員', target: '病人' },
        promptFragment: '這是醫療場景的對話。請使用正確的醫學術語，注意藥名、劑量、症狀描述的精確性。',
        safetyHint: '不可自行診斷或建議用藥/處方。',
    },
    legal: {
        code: 'legal',
        name: '法律',
        nameEn: 'Legal',
        icon: '⚖️',
        speakerLabels: { source: '律師', target: '當事人' },
        promptFragment: '這是法律場景的對話。請使用正確的法律術語，注意法條、權利義務、程序用語的精確性。',
        safetyHint: '不可提供法律意見或判斷案件結果。',
    },
    finance: {
        code: 'finance',
        name: '金融',
        nameEn: 'Finance',
        icon: '💰',
        speakerLabels: { source: '顧問', target: '客戶' },
        promptFragment: '這是金融場景的對話。請使用正確的金融術語，注意金額、利率、投資標的名稱的精確性。',
        safetyHint: '不可提供投資建議或保證收益。',
    },
    tech: {
        code: 'tech',
        name: '科技',
        nameEn: 'Technology',
        icon: '💻',
        speakerLabels: { source: '工程師', target: '客戶' },
        promptFragment: '這是科技/IT 場景的對話。請使用正確的技術術語，常見英文技術名詞可保留原文。',
        safetyHint: '技術方案應忠實傳達，不可擅自簡化或省略技術細節。',
    },
    business: {
        code: 'business',
        name: '商務',
        nameEn: 'Business',
        icon: '💼',
        speakerLabels: { source: '主持人', target: '與會者' },
        promptFragment: '這是商務會議場景的對話。請使用專業商務用語，注意公司名稱、數字、日期的精確性。',
        safetyHint: '商業機密內容應忠實翻譯，不可擅自增減。',
    },
    aviation: {
        code: 'aviation',
        name: '航空',
        nameEn: 'Aviation',
        icon: '✈️',
        speakerLabels: { source: '簽派/機長', target: '航管/組員' },
        promptFragment: '這是航空場景的對話。請使用正確的航空術語和 ICAO 標準用語，注意高度、速度、頻率、跑道編號等數據的精確性。',
        safetyHint: '涉及飛行安全的指令和數據必須 100% 精確，不可省略或改寫。',
    },
    general: {
        code: 'general',
        name: '通用',
        nameEn: 'General',
        icon: '🌐',
        speakerLabels: { source: '說話者 A', target: '說話者 B' },
        promptFragment: '這是一般對話場景。請使用自然、通順的語言。',
        safetyHint: '',
    },
};

/**
 * 取得指定領域的配置
 */
export function getDomainConfig(domain: DomainCode): DomainConfig {
    return DOMAIN_CONFIGS[domain] || DOMAIN_CONFIGS.general;
}

/**
 * 取得所有領域配置（供前端顯示用）
 */
export function getAllDomains(): DomainConfig[] {
    return Object.values(DOMAIN_CONFIGS);
}

/**
 * 取得所有領域代碼
 */
export function getAllDomainCodes(): DomainCode[] {
    return Object.keys(DOMAIN_CONFIGS) as DomainCode[];
}

/**
 * 檢查是否為有效的領域代碼
 */
export function isValidDomain(domain: string): domain is DomainCode {
    return domain in DOMAIN_CONFIGS;
}

/**
 * 取得通用安全規則（所有領域共用）
 */
export function getCommonSafetyRules(): string {
    return `安全規則：
- 數字（金額、日期、劑量等）必須 100% 保真，不可改寫
- 不可捏造原文沒有的資訊
- 專有名詞（人名、機構名、產品名）必須準確翻譯或保留`;
}

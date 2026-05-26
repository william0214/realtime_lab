/**
 * 文字準確度評分模組
 * - CER (Character Error Rate): 字符錯誤率，適合中文/日文
 * - WER (Word Error Rate): 詞錯誤率，適合英文/越南文
 * - 繁體中文比例檢測
 */

/**
 * 計算兩個字串的 Levenshtein 編輯距離
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * 正規化文字：移除標點、空白、轉小寫
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[，。！？、；：「」『』【】《》〈〉…—\-\s\.,!?;:'"()\[\]]/g, "")
    .trim();
}

/**
 * 計算字符錯誤率 CER (0-100)
 * 適合中文、日文等字符語言
 */
export function calcCer(reference: string, hypothesis: string): number {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (ref.length === 0) return hypothesis.length === 0 ? 0 : 100;
  const dist = levenshtein(ref, hyp);
  return Math.min(100, (dist / ref.length) * 100);
}

/**
 * 計算詞錯誤率 WER (0-100)
 * 適合英文、越南文等詞語言
 */
export function calcWer(reference: string, hypothesis: string): number {
  const refWords = normalize(reference).split(/\s+/).filter(Boolean);
  const hypWords = normalize(hypothesis).split(/\s+/).filter(Boolean);
  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 100;
  const dist = levenshtein(refWords.join(" "), hypWords.join(" "));
  return Math.min(100, (dist / refWords.length) * 100);
}

/**
 * 根據語言自動選擇 CER 或 WER
 */
export function calcAccuracy(
  reference: string,
  hypothesis: string,
  lang: string
): number {
  // 中文、日文、泰文使用 CER
  const cerLangs = ["zh", "ja", "th"];
  const errorRate = cerLangs.includes(lang)
    ? calcCer(reference, hypothesis)
    : calcWer(reference, hypothesis);
  // 轉換為準確度分數 (100 - error rate)
  return Math.max(0, 100 - errorRate);
}

// ============================================================
// 繁體中文比例檢測
// ============================================================

/**
 * 常見簡體字 → 繁體字對照（取樣，用於快速偵測）
 */
const SIMPLIFIED_CHARS = new Set([
  "爱", "办", "报", "边", "别", "补", "产", "长", "厂", "车",
  "处", "传", "从", "当", "党", "导", "点", "电", "东", "动",
  "对", "发", "风", "复", "个", "给", "关", "广", "国", "过",
  "还", "汉", "号", "后", "华", "话", "环", "会", "机", "几",
  "际", "将", "进", "经", "开", "来", "乐", "类", "里", "联",
  "两", "临", "领", "龙", "妈", "买", "门", "面", "鸟", "农",
  "欧", "气", "钱", "亲", "请", "区", "热", "认", "时", "实",
  "书", "数", "说", "岁", "体", "听", "头", "图", "团", "万",
  "为", "问", "务", "现", "线", "乡", "响", "写", "选", "学",
  "样", "业", "义", "医", "应", "员", "运", "杂", "张", "这",
  "证", "只", "种", "众", "转", "装", "总", "组",
]);

/**
 * 常見繁體字（用於確認繁體輸出）
 */
const TRADITIONAL_CHARS = new Set([
  "愛", "辦", "報", "邊", "別", "補", "產", "長", "廠", "車",
  "處", "傳", "從", "當", "黨", "導", "點", "電", "東", "動",
  "對", "發", "風", "複", "個", "給", "關", "廣", "國", "過",
  "還", "漢", "號", "後", "華", "話", "環", "會", "機", "幾",
  "際", "將", "進", "經", "開", "來", "樂", "類", "裡", "聯",
  "兩", "臨", "領", "龍", "媽", "買", "門", "麵", "鳥", "農",
  "歐", "氣", "錢", "親", "請", "區", "熱", "認", "時", "實",
  "書", "數", "說", "歲", "體", "聽", "頭", "圖", "團", "萬",
  "為", "問", "務", "現", "線", "鄉", "響", "寫", "選", "學",
  "樣", "業", "義", "醫", "應", "員", "運", "雜", "張", "這",
  "證", "只", "種", "眾", "轉", "裝", "總", "組",
]);

/**
 * 計算文字中繁體中文字符的比例 (0-100)
 * 返回值越高代表越多繁體字
 */
export function calcTradChineseRatio(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  let tradCount = 0;
  let simpCount = 0;
  let chineseCount = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // 是否為 CJK 字符
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df)
    ) {
      chineseCount++;
      if (TRADITIONAL_CHARS.has(char)) tradCount++;
      if (SIMPLIFIED_CHARS.has(char)) simpCount++;
    }
  }

  if (chineseCount === 0) return 100; // 無中文字符，視為通過（可能是純英文翻譯）

  // 計算繁體比例（有繁體字且無簡體字 = 100%）
  if (tradCount === 0 && simpCount === 0) return 75; // 無法判斷，給中性分數
  if (simpCount === 0) return 100;
  if (tradCount === 0) return 0;

  return Math.round((tradCount / (tradCount + simpCount)) * 100);
}

/**
 * 判斷文字是否含有簡體字
 */
export function hasSimplifiedChinese(text: string): boolean {
  for (const char of text) {
    if (SIMPLIFIED_CHARS.has(char)) return true;
  }
  return false;
}

/**
 * 計算翻譯品質分數（0-100）
 * 基於：是否有輸出 + 長度合理性 + 語言一致性
 */
export function calcTranslationScore(
  translatedText: string,
  targetLang: string,
  sourceLang: string
): number {
  if (!translatedText || translatedText.trim().length === 0) return 0;

  let score = 50; // 基礎分：有輸出

  // 長度合理性（不能太短也不能太長）
  const len = translatedText.trim().length;
  if (len >= 5) score += 20;
  if (len >= 10) score += 10;

  // 繁體中文檢查（目標語言為中文時）
  if (targetLang === "zh" || targetLang === "zh-TW") {
    const tradRatio = calcTradChineseRatio(translatedText);
    if (tradRatio >= 80) score += 20;
    else if (tradRatio >= 50) score += 10;
    else score -= 20; // 簡體字扣分
  }

  // 確認翻譯語言與來源語言不同（避免原文直接輸出）
  if (sourceLang === "zh" || sourceLang === "zh-TW") {
    // 來源是中文，翻譯不應含大量中文
    const chineseRatio = [...translatedText].filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x4e00 && code <= 0x9fff;
    }).length / translatedText.length;
    if (chineseRatio < 0.3) score += 0; // 正常
    else score -= 15; // 可能沒翻譯
  }

  return Math.max(0, Math.min(100, score));
}

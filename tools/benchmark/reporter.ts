/**
 * 報告產生器
 * 輸出 JSON 原始資料 + Markdown 人類可讀報告
 */
import * as fs from "fs";
import * as path from "path";
import {
  BenchmarkReport,
  ProviderResult,
  ProviderName,
  ComparisonTable,
} from "./types";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  "openai-whisper-batch": "OpenAI Whisper Batch (Baseline)",
  "openai-realtime-whisper": "gpt-realtime-whisper",
  "openai-translate": "gpt-realtime-translate",
  "openai-realtime2": "gpt-realtime-2",
  gladia: "Gladia Solaria-1",
  deepgram: "Deepgram Nova-3",
  soniox: "Soniox",
};

function avg(nums: number[]): number {
  const valid = nums.filter((n) => n !== null && !isNaN(n));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function rankProviders(
  results: ProviderResult[],
  getValue: (r: ProviderResult) => number,
  lowerIsBetter = true
): ProviderName[] {
  const active = results.filter((r) => !r.skipped);
  return active
    .sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      return lowerIsBetter ? va - vb : vb - va;
    })
    .map((r) => r.provider);
}

export function buildComparison(results: ProviderResult[]): ComparisonTable {
  const rankByFirstPartial = rankProviders(
    results,
    (r) => r.summary.avgFirstPartialMs || 9999,
    true
  );
  const rankByFinalLatency = rankProviders(
    results,
    (r) => r.summary.avgFinalMs || 9999,
    true
  );
  const rankByCer = rankProviders(results, (r) => r.summary.avgCer, true);
  const rankByTranslationScore = rankProviders(
    results,
    (r) => r.summary.avgTranslationScore,
    false
  );
  const rankByTradChinese = rankProviders(
    results,
    (r) => r.summary.avgTradChineseRatio,
    false
  );
  const rankBySuccessRate = rankProviders(
    results,
    (r) => r.summary.successRate,
    false
  );

  const bestForLatency = rankByFinalLatency[0] || "openai-whisper-batch";
  const bestForAccuracy = rankByCer[0] || "openai-whisper-batch";
  const bestForTradChinese = rankByTradChinese[0] || "openai-whisper-batch";

  // 護理場景綜合評分（延遲 30% + 準確度 40% + 繁體中文 30%）
  const active = results.filter((r) => !r.skipped);
  const scores = active.map((r) => {
    const latencyScore =
      100 - Math.min(100, (r.summary.avgFinalMs / 3000) * 100);
    const accuracyScore = 100 - r.summary.avgCer;
    const tradScore = r.summary.avgTradChineseRatio;
    return {
      provider: r.provider,
      score: latencyScore * 0.3 + accuracyScore * 0.4 + tradScore * 0.3,
    };
  });
  scores.sort((a, b) => b.score - a.score);
  const bestOverall = scores[0]?.provider || "openai-whisper-batch";

  const notes = [
    `綜合評分權重：延遲 30% + 準確度 40% + 繁體中文 30%`,
    `最佳延遲：${PROVIDER_LABELS[bestForLatency]}`,
    `最佳準確度：${PROVIDER_LABELS[bestForAccuracy]}`,
    `最佳繁體中文：${PROVIDER_LABELS[bestForTradChinese]}`,
    `護理場景綜合最佳：${PROVIDER_LABELS[bestOverall]}`,
  ].join("\n");

  return {
    rankByFirstPartial,
    rankByFinalLatency,
    rankByCer,
    rankByTranslationScore,
    rankByTradChinese,
    rankBySuccessRate,
    nursingRecommendation: {
      bestForLatency,
      bestForAccuracy,
      bestForTradChinese,
      bestOverall,
      notes,
    },
  };
}

export function saveReport(report: BenchmarkReport, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });

  // 儲存 JSON
  const jsonPath = path.join(outputDir, "benchmark-result.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 JSON 報告已儲存: ${jsonPath}`);

  // 產生 Markdown
  const md = generateMarkdown(report);
  const mdPath = path.join(outputDir, "benchmark-report.md");
  fs.writeFileSync(mdPath, md);
  console.log(`📊 Markdown 報告已儲存: ${mdPath}`);
}

function generateMarkdown(report: BenchmarkReport): string {
  const { results, comparison, config } = report;
  const active = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  const lines: string[] = [];

  lines.push("# Realtime API 自動化測試報告");
  lines.push("");
  lines.push(`**產生時間**：${report.generatedAt}`);
  lines.push(`**來源語言**：${config.sourceLang} → **目標語言**：${config.targetLang}`);
  lines.push(`**測試句子數**：${config.providers.length} 個 Provider × 每句 ${config.repeatCount} 次`);
  lines.push("");

  // 總覽表格
  lines.push("## 整體比較");
  lines.push("");
  lines.push(
    "| Provider | 首字延遲 | Final 延遲 | 翻譯延遲 | CER (↓) | 翻譯分 | 繁中比例 | 成功率 |"
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|"
  );

  for (const r of active) {
    const s = r.summary;
    const fp =
      s.avgFirstPartialMs > 0 ? `${s.avgFirstPartialMs.toFixed(0)}ms` : "N/A";
    const fl = s.avgFinalMs > 0 ? `${s.avgFinalMs.toFixed(0)}ms` : "N/A";
    const tl =
      s.avgTranslationMs > 0 ? `${s.avgTranslationMs.toFixed(0)}ms` : "N/A";
    const cer = `${s.avgCer.toFixed(1)}%`;
    const ts = `${s.avgTranslationScore.toFixed(0)}/100`;
    const tc = `${s.avgTradChineseRatio.toFixed(0)}%`;
    const sr = `${s.successRate.toFixed(0)}%`;
    lines.push(
      `| **${PROVIDER_LABELS[r.provider]}** | ${fp} | ${fl} | ${tl} | ${cer} | ${ts} | ${tc} | ${sr} |`
    );
  }
  lines.push("");

  // 跳過的 provider
  if (skipped.length > 0) {
    lines.push("### 跳過的 Provider（API Key 未設定）");
    lines.push("");
    for (const r of skipped) {
      lines.push(`- **${PROVIDER_LABELS[r.provider]}**：${r.skipReason}`);
    }
    lines.push("");
  }

  // 排名
  lines.push("## 各指標排名");
  lines.push("");
  lines.push("| 排名 | 首字延遲 | Final 延遲 | 準確度 (CER) | 翻譯品質 | 繁體中文 | 成功率 |");
  lines.push("|---|---|---|---|---|---|---|");

  const maxLen = Math.max(
    comparison.rankByFirstPartial.length,
    comparison.rankByFinalLatency.length,
    comparison.rankByCer.length,
    comparison.rankByTranslationScore.length,
    comparison.rankByTradChinese.length,
    comparison.rankBySuccessRate.length
  );

  const medals = ["🥇", "🥈", "🥉"];
  for (let i = 0; i < maxLen; i++) {
    const medal = medals[i] || `${i + 1}`;
    const fp = comparison.rankByFirstPartial[i]
      ? PROVIDER_LABELS[comparison.rankByFirstPartial[i]].replace(" (Baseline)", "")
      : "-";
    const fl = comparison.rankByFinalLatency[i]
      ? PROVIDER_LABELS[comparison.rankByFinalLatency[i]].replace(" (Baseline)", "")
      : "-";
    const cer = comparison.rankByCer[i]
      ? PROVIDER_LABELS[comparison.rankByCer[i]].replace(" (Baseline)", "")
      : "-";
    const ts = comparison.rankByTranslationScore[i]
      ? PROVIDER_LABELS[comparison.rankByTranslationScore[i]].replace(" (Baseline)", "")
      : "-";
    const tc = comparison.rankByTradChinese[i]
      ? PROVIDER_LABELS[comparison.rankByTradChinese[i]].replace(" (Baseline)", "")
      : "-";
    const sr = comparison.rankBySuccessRate[i]
      ? PROVIDER_LABELS[comparison.rankBySuccessRate[i]].replace(" (Baseline)", "")
      : "-";
    lines.push(`| ${medal} | ${fp} | ${fl} | ${cer} | ${ts} | ${tc} | ${sr} |`);
  }
  lines.push("");

  // 護理場景建議
  lines.push("## 護理場景建議");
  lines.push("");
  lines.push("```");
  lines.push(comparison.nursingRecommendation.notes);
  lines.push("```");
  lines.push("");

  // 各語言詳細結果
  lines.push("## 各語言詳細結果");
  lines.push("");
  const langs = [...new Set(active.flatMap((r) => Object.keys(r.summary.byLang)))];
  for (const lang of langs) {
    lines.push(`### ${lang}`);
    lines.push("");
    lines.push("| Provider | 成功率 | CER | Final 延遲 |");
    lines.push("|---|---|---|---|");
    for (const r of active) {
      const byLang = r.summary.byLang[lang];
      if (byLang) {
        lines.push(
          `| ${PROVIDER_LABELS[r.provider].replace(" (Baseline)", "")} | ${byLang.successRate.toFixed(0)}% | ${byLang.avgCer.toFixed(1)}% | ${byLang.avgFinalMs.toFixed(0)}ms |`
        );
      }
    }
    lines.push("");
  }

  // 繁體中文詳細分析
  lines.push("## 繁體中文輸出分析");
  lines.push("");
  lines.push(
    "> 此項目為護理翻譯系統的關鍵需求：翻譯輸出必須為繁體中文，不得出現簡體字。"
  );
  lines.push("");
  for (const r of active) {
    const tradRatio = r.summary.avgTradChineseRatio;
    const status =
      tradRatio >= 90 ? "✅ 優秀" : tradRatio >= 70 ? "⚠️ 尚可" : "❌ 不合格";
    lines.push(
      `- **${PROVIDER_LABELS[r.provider]}**：${tradRatio.toFixed(0)}% ${status}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

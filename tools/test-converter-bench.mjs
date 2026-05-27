/**
 * 簡繁轉換器效能比較：opencc-js vs zhconv
 * 使用 .mjs 避免 tsx 的 WASM 載入問題
 */
import * as OpenCC from "opencc-js";
import { zhconv } from "zhconv";

// 護理場景測試句子（模擬 gpt-realtime-whisper 輸出的簡體）
const TEST_SENTENCES = [
  "请问您今天哪里不舒服？",
  "我头痛已经三天了，而且有点发烧。",
  "请问您对什么药物过敏吗？",
  "我对青霉素过敏，吃了会起疹子。",
  "这个药一天吃三次，每次一颗，饭后服用。",
  "请问挂号要怎么办理？",
  "您需要先到一楼服务台抽号码牌。",
  "我的肚子很痛，痛了一整个晚上。",
  "请您先做一个血液检查，报告大概两个小时后出来。",
  "谢谢医生，请问下次什么时候回诊？",
];

const ITERATIONS = 10000;

function benchOpenCC() {
  const converter = OpenCC.Converter({ from: "cn", to: "tw" });
  for (const s of TEST_SENTENCES) converter(s); // 預熱
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const s of TEST_SENTENCES) converter(s);
  }
  return performance.now() - start;
}

function benchZhconv() {
  for (const s of TEST_SENTENCES) zhconv(s, "zh-TW"); // 預熱
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const s of TEST_SENTENCES) zhconv(s, "zh-TW");
  }
  return performance.now() - start;
}

// 驗證輸出正確性
const openccConverter = OpenCC.Converter({ from: "cn", to: "tw" });
console.log("=== 輸出正確性驗證 ===");
for (const s of TEST_SENTENCES.slice(0, 3)) {
  const openccResult = openccConverter(s);
  const zhconvResult = zhconv(s, "zh-TW");
  const match = openccResult === zhconvResult ? "✅ 相同" : "⚠️ 不同";
  console.log(`輸入:      ${s}`);
  console.log(`opencc-js: ${openccResult}`);
  console.log(`zhconv:    ${zhconvResult}`);
  console.log(`${match}\n`);
}

console.log(`=== 效能測試（${ITERATIONS.toLocaleString()} 次 × ${TEST_SENTENCES.length} 句）===`);
const total = ITERATIONS * TEST_SENTENCES.length;

const openccTime = benchOpenCC();
const zhconvTime = benchZhconv();

console.log(`opencc-js: ${openccTime.toFixed(1)}ms 總計 | ${(openccTime / total * 1000).toFixed(3)}µs/次`);
console.log(`zhconv:    ${zhconvTime.toFixed(1)}ms 總計 | ${(zhconvTime / total * 1000).toFixed(3)}µs/次`);

const ratio = openccTime / zhconvTime;
if (ratio > 1) {
  console.log(`\n🏆 zhconv 快 ${ratio.toFixed(1)}x`);
} else {
  console.log(`\n🏆 opencc-js 快 ${(1/ratio).toFixed(1)}x`);
}

// 單次轉換延遲
console.log("\n=== 單次轉換延遲（模擬實際場景，N=1000）===");
const singleSentence = "请问您今天哪里不舒服？请问您对什么药物过敏吗？这个药一天吃三次，每次一颗，饭后服用。";
const N = 1000;

let t0 = performance.now();
for (let i = 0; i < N; i++) openccConverter(singleSentence);
const openccSingle = (performance.now() - t0) / N;

t0 = performance.now();
for (let i = 0; i < N; i++) zhconv(singleSentence, "zh-TW");
const zhconvSingle = (performance.now() - t0) / N;

console.log(`opencc-js 單次: ${(openccSingle * 1000).toFixed(2)}µs`);
console.log(`zhconv 單次:    ${(zhconvSingle * 1000).toFixed(2)}µs`);
console.log(`\n（ASR Final 延遲 ~1684ms，兩者後處理開銷均可忽略）`);

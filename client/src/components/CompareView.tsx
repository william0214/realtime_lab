/**
 * CompareView.tsx
 * 三模型並排比較主介面
 * 三欄佈局：gpt-realtime-2 | gpt-realtime-translate | gpt-realtime-whisper
 */

import { useState } from 'react';
import { useCompare, ModelKey, ModelState, HistoryEntry } from '../hooks/useCompare';
import './CompareView.css';

// ─── 語言選項 ────────────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en',    label: 'English' },
  { code: 'ja',    label: '日本語' },
  { code: 'ko',    label: '한국어' },
  { code: 'vi',    label: 'Tiếng Việt' },
  { code: 'id',    label: 'Bahasa Indonesia' },
  { code: 'th',    label: 'ภาษาไทย' },
];

// ─── 模型顏色主題 ─────────────────────────────────────────────────────────────
const MODEL_THEME: Record<ModelKey, { accent: string; badge: string; icon: string }> = {
  VOICE_AGENT: { accent: '#6366f1', badge: 'badge-indigo', icon: '🤖' },
  TRANSLATE:   { accent: '#10b981', badge: 'badge-green',  icon: '🌐' },
  WHISPER:     { accent: '#f59e0b', badge: 'badge-amber',  icon: '🎙️' },
};

// ─── 延遲指示燈 ──────────────────────────────────────────────────────────────
function LatencyBadge({ ms, label }: { ms?: number; label: string }) {
  if (ms === undefined) return null;
  const color = ms < 300 ? '#10b981' : ms < 800 ? '#f59e0b' : '#ef4444';
  return (
    <span className="latency-badge" style={{ borderColor: color, color }}>
      {label}: {ms}ms
    </span>
  );
}

// ─── 星評分 ──────────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`star ${(value ?? 0) >= n ? 'filled' : ''}`}
          onClick={() => onChange(n)}
          title={`${n} 星`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── 歷史條目 ────────────────────────────────────────────────────────────────
function HistoryItem({
  entry,
  onRate,
  accent,
}: {
  entry: HistoryEntry;
  onRate: (id: string, rating: number) => void;
  accent: string;
}) {
  return (
    <div className="history-item" style={{ borderLeftColor: accent }}>
      <div className="history-meta">
        <span className="history-time">
          {new Date(entry.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <div className="history-latencies">
          <LatencyBadge ms={entry.latency.firstTranscriptDelta} label="首字" />
          <LatencyBadge ms={entry.latency.transcriptComplete}   label="字幕" />
          <LatencyBadge ms={entry.latency.firstTranslationDelta} label="翻譯首字" />
          <LatencyBadge ms={entry.latency.translationComplete}  label="翻譯完成" />
        </div>
      </div>
      <div className="history-transcript">{entry.transcript}</div>
      {entry.translation && (
        <div className="history-translation">{entry.translation}</div>
      )}
      <div className="history-footer">
        <StarRating value={entry.rating} onChange={(v) => onRate(entry.id, v)} />
      </div>
    </div>
  );
}

// ─── 單一模型欄位 ─────────────────────────────────────────────────────────────
function ModelColumn({
  model,
  onRate,
}: {
  model: ModelState;
  onRate: (entryId: string, rating: number) => void;
}) {
  const theme = MODEL_THEME[model.modelKey];

  return (
    <div className="model-column">
      {/* 欄位標頭 */}
      <div className="model-header" style={{ borderTopColor: theme.accent }}>
        <div className="model-title">
          <span className="model-icon">{theme.icon}</span>
          <span className="model-label">{model.label}</span>
          <span
            className={`model-status-dot ${model.connected ? 'connected' : 'disconnected'}`}
            title={model.connected ? '已連線' : '未連線'}
          />
        </div>
        <p className="model-desc">{model.description}</p>
        {model.error && (
          <div className="model-error">⚠️ {model.error}</div>
        )}
      </div>

      {/* 即時字幕區 */}
      <div className="live-section">
        <div className="section-label">即時字幕</div>
        <div className="live-text transcript-text">
          {model.transcriptLive || <span className="placeholder">等待語音輸入...</span>}
        </div>
      </div>

      {/* 翻譯輸出區（WHISPER 無翻譯） */}
      {model.modelKey !== 'WHISPER' && (
        <div className="live-section">
          <div className="section-label">翻譯輸出</div>
          <div className="live-text translation-text" style={{ color: theme.accent }}>
            {model.translationLive || <span className="placeholder">翻譯結果將顯示於此...</span>}
          </div>
        </div>
      )}

      {/* 延遲數據 */}
      <div className="latency-section">
        <div className="section-label">延遲數據</div>
        <div className="latency-grid">
          <LatencyBadge ms={model.latency.firstTranscriptDelta}  label="首字" />
          <LatencyBadge ms={model.latency.transcriptComplete}    label="字幕完成" />
          {model.modelKey !== 'WHISPER' && (
            <>
              <LatencyBadge ms={model.latency.firstTranslationDelta} label="翻譯首字" />
              <LatencyBadge ms={model.latency.translationComplete}   label="翻譯完成" />
            </>
          )}
        </div>
        {!model.latency.firstTranscriptDelta && (
          <span className="placeholder">尚無延遲數據</span>
        )}
      </div>

      {/* 歷史紀錄 */}
      <div className="history-section">
        <div className="section-label">
          歷史紀錄
          <span className="history-count">{model.history.length} 筆</span>
        </div>
        <div className="history-list">
          {model.history.length === 0 ? (
            <span className="placeholder">尚無紀錄</span>
          ) : (
            [...model.history].reverse().map(entry => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                onRate={onRate}
                accent={theme.accent}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────
export default function CompareView() {
  const {
    status,
    sourceLang,
    targetLang,
    models,
    isRecording,
    errorMsg,
    initCompare,
    updateLanguages,
    startRecording,
    stopRecording,
    rateEntry,
    clearHistory,
    exportSession,
  } = useCompare({ serverUrl: 'http://localhost:3001' });

  const [localSource, setLocalSource] = useState(sourceLang);
  const [localTarget, setLocalTarget] = useState(targetLang);

  const handleApplyLang = () => {
    updateLanguages(localSource, localTarget);
  };

  const statusLabel: Record<string, string> = {
    idle:       '未初始化',
    connecting: '連線中...',
    ready:      '就緒',
    recording:  '錄音中',
    error:      '錯誤',
  };

  const connectedCount = Object.values(models).filter(m => m.connected).length;

  return (
    <div className="compare-view">
      {/* ── 頂部控制列 ── */}
      <div className="compare-toolbar">
        <div className="toolbar-left">
          <h1 className="compare-title">
            <span className="title-icon">⚡</span>
            三模型並排比較
          </h1>
          <div className="status-indicator">
            <span className={`status-dot status-${status}`} />
            <span className="status-text">{statusLabel[status] ?? status}</span>
            {status === 'ready' || status === 'recording' ? (
              <span className="connected-count">{connectedCount}/3 模型已連線</span>
            ) : null}
          </div>
        </div>

        <div className="toolbar-center">
          {/* 語言選擇 */}
          <div className="lang-selector">
            <select
              value={localSource}
              onChange={e => setLocalSource(e.target.value)}
              className="lang-select"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <span className="lang-arrow">→</span>
            <select
              value={localTarget}
              onChange={e => setLocalTarget(e.target.value)}
              className="lang-select"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-outline" onClick={handleApplyLang}>
              套用語言
            </button>
          </div>
        </div>

        <div className="toolbar-right">
          {/* 初始化按鈕 */}
          {status === 'idle' || status === 'error' ? (
            <button className="btn btn-primary" onClick={initCompare}>
              🔌 初始化三模型
            </button>
          ) : null}

          {/* 錄音控制 */}
          {(status === 'ready' || status === 'recording') && (
            <>
              {!isRecording ? (
                <button className="btn btn-record" onClick={startRecording}>
                  🎙️ 開始錄音
                </button>
              ) : (
                <button className="btn btn-stop" onClick={stopRecording}>
                  ⏹ 停止錄音
                </button>
              )}
            </>
          )}

          {/* 工具按鈕 */}
          <button className="btn btn-sm btn-outline" onClick={clearHistory} title="清除所有歷史">
            🗑 清除
          </button>
          <button className="btn btn-sm btn-outline" onClick={exportSession} title="匯出 JSON">
            📥 匯出
          </button>
        </div>
      </div>

      {/* 錯誤訊息 */}
      {errorMsg && (
        <div className="error-banner">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ── 三欄主體 ── */}
      <div className="compare-grid">
        {(['VOICE_AGENT', 'TRANSLATE', 'WHISPER'] as ModelKey[]).map(key => (
          <ModelColumn
            key={key}
            model={models[key]}
            onRate={(entryId, rating) => rateEntry(key, entryId, rating)}
          />
        ))}
      </div>

      {/* ── 底部說明 ── */}
      <div className="compare-footer">
        <div className="footer-note">
          <strong>使用說明：</strong>
          點擊「初始化三模型」連接 OpenAI Realtime API，再點「開始錄音」同時向三個模型發送語音。
          每個模型的即時字幕、翻譯結果與延遲數據將並排顯示，可對每段翻譯進行 1-5 星評分，最後匯出 JSON 進行分析。
        </div>
        <div className="footer-note">
          <strong>延遲指標說明：</strong>
          <span style={{ color: '#10b981' }}>綠色 &lt;300ms</span>（優秀）、
          <span style={{ color: '#f59e0b' }}>黃色 300-800ms</span>（可接受）、
          <span style={{ color: '#ef4444' }}>紅色 &gt;800ms</span>（需改善）
        </div>
      </div>
    </div>
  );
}

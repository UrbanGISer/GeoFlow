import { useState } from "react";
import { type AIConfig, DEFAULT_AI_CONFIG, saveAIConfig } from "../types";

/** AI provider settings (base URL / API key / model) — shared by the
 * left-panel AI tab and the AI Studio page. Persists to localStorage. */
export function AISettingsPanel({
  config,
  onChange,
  compact = false,
}: {
  config: AIConfig;
  onChange: (c: AIConfig) => void;
  compact?: boolean;
}) {
  const [localKey, setLocalKey] = useState(config.api_key);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const next = { ...config, api_key: localKey };
    onChange(next);
    saveAIConfig(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className={compact ? "nf-ai-settings-panel nf-ai-settings-compact" : "nf-ai-settings-panel"}>
      <h3 className="nf-ai-settings-title">AI Provider Settings</h3>
      <p className="nf-ai-settings-sub">
        Saved locally in your browser. Defaults are pre-configured for Google AI Studio
        (Gemini — free tier: 15 RPM, 1500 RPD). Used by AI Studio and the in-node AI Coding.
      </p>
      <div className={compact ? "nf-ai-settings-grid nf-ai-settings-grid-1col" : "nf-ai-settings-grid"}>
        <div className="nf-field">
          <label className="nf-field-label">Base URL</label>
          <input
            type="text"
            value={config.base_url}
            onChange={(e) => onChange({ ...config, base_url: e.target.value })}
          />
        </div>
        <div className="nf-field">
          <label className="nf-field-label">API Key</label>
          <input
            type="password"
            placeholder="Paste your Google AI Studio API key here"
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
            onBlur={() => onChange({ ...config, api_key: localKey })}
          />
          <span className="nf-field-hint">
            Get a free key at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
          </span>
        </div>
        <div className="nf-field">
          <label className="nf-field-label">Model</label>
          <select
            value={config.model}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
          >
            <option value="gemini-2.5-flash">gemini-2.5-flash (recommended, free)</option>
            <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            <option value="gpt-4o-mini">gpt-4o-mini (OpenAI)</option>
            <option value="deepseek-chat">deepseek-chat</option>
          </select>
        </div>
        <div className="nf-field nf-field-row">
          <button type="button" className="nf-btn nf-btn-primary" onClick={handleSave}>
            {saved ? "Saved ✓" : "Save Settings"}
          </button>
          <button
            type="button"
            className="nf-btn"
            onClick={() => {
              onChange({ ...DEFAULT_AI_CONFIG });
              setLocalKey("");
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

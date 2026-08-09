"use client";

import { useState } from "react";
import {
  AI_PROVIDERS,
  type AiProvider,
  type AiProviderCredentialSummary,
} from "../../../src/domain/repositories/AiProviderCredentialRepository";
import { MODEL_CATALOG, defaultModelId } from "../../../src/domain/rules/aiModelCatalog";
import { ConfirmDialog } from "../../_components/ConfirmDialog";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT) (未対応)",
  google: "Google (Gemini) (未対応)",
  xai: "xAI (Grok) (未対応)",
};

/**
 * 実際にAPIを呼び出す実装(src/infrastructure/ai/配下)があるのはAnthropicのみ。
 * openai/google/xaiはAPIキーを保存できてしまうが、AI要因分析等のどの機能からも呼び出されない
 * (近日対応予定)。保存しても使われないことを画面上で明示するためのフラグ。
 */
const UNSUPPORTED_PROVIDERS: ReadonlySet<AiProvider> = new Set(["openai", "google", "xai"]);

const PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  xai: "https://console.x.ai",
};

type SaveState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string };

export function AiSettingsManager({
  initialCredentials,
}: {
  initialCredentials: AiProviderCredentialSummary[];
}) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(defaultModelId("anthropic") ?? "");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [deletingProvider, setDeletingProvider] = useState<AiProvider | null>(null);
  /** 削除の確認待ちプロバイダ。どのキーを消すのかを画面に出してから確定させる。 */
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null);

  const existing = credentials.find((c) => c.provider === provider);

  function handleProviderChange(next: AiProvider) {
    setProvider(next);
    setModel(defaultModelId(next) ?? "");
    setSaveState({ status: "idle" });
  }

  async function handleSave() {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      setSaveState({ status: "error", message: "APIキーを入力してください" });
      return;
    }

    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/ai-provider-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: trimmed, model }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setSaveState({ status: "error", message: data?.error ?? "保存に失敗しました" });
        return;
      }

      setApiKey("");
      setSaveState({ status: "idle" });
      const saved: AiProviderCredentialSummary = {
        provider,
        apiKeyLast4: trimmed.slice(-4),
        model,
        updatedAt: Date.now(),
        updatedBy: null,
      };
      setCredentials((prev) => [...prev.filter((c) => c.provider !== provider), saved]);
    } catch {
      setSaveState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  async function handleDelete(target: AiProvider) {
    setPendingDelete(null);
    setDeletingProvider(target);
    try {
      const res = await fetch(`/api/ai-provider-credentials?provider=${target}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCredentials((prev) => prev.filter((c) => c.provider !== target));
      }
    } finally {
      setDeletingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">APIキーを登録・上書きする</h2>
        <p className="mt-1 text-xs text-ink-muted">
          登録済みのプロバイダも、この画面から再入力すると丸ごと上書きされます(部分編集はできません)。
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            プロバイダ
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          {UNSUPPORTED_PROVIDERS.has(provider) ? (
            <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs leading-relaxed">
              現在このプロバイダーは未対応です(近日対応予定)。APIキーを保存すること自体は可能ですが、
              AI要因分析などの機能からはまだ呼び出されず、保存しても利用されません。
            </div>
          ) : null}

          <p className="text-xs text-ink-muted">
            APIキーの取得方法:{" "}
            <a
              href={PROVIDER_KEY_URLS[provider]}
              target="_blank"
              rel="noreferrer"
              className="text-brand-deep underline"
            >
              {PROVIDER_KEY_URLS[provider]}
            </a>
          </p>

          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            APIキー
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={existing ? `登録済み(末尾 ${existing.apiKeyLast4})を上書きする場合のみ入力` : "sk-..."}
              autoComplete="off"
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            モデル
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            >
              {MODEL_CATALOG[provider].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-ink-muted">
              {MODEL_CATALOG[provider].find((m) => m.id === model)?.description}
            </span>
          </label>

          {saveState.status === "error" ? (
            <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
              {saveState.message}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.status === "saving"}
            className="btn btn-primary pressable self-start"
          >
            {saveState.status === "saving" ? "保存しています…" : "保存する"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">登録済みのAPIキー</h2>
        {credentials.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">まだ何も登録されていません。</p>
        ) : (
          <div className="mt-3 flex flex-col">
            {credentials.map((c) => (
              <div
                key={c.provider}
                className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm last:border-b-0"
              >
                <div>
                  <p className="font-semibold text-ink">{PROVIDER_LABELS[c.provider]}</p>
                  <p className="text-xs text-ink-muted">
                    末尾 {c.apiKeyLast4} / {c.model} / 更新: {new Date(c.updatedAt).toLocaleString("ja-JP")}
                    {c.updatedBy ? ` (${c.updatedBy})` : ""}
                  </p>
                  {UNSUPPORTED_PROVIDERS.has(c.provider) ? (
                    <p className="mt-0.5 text-[11px] text-danger">
                      未対応のため保存済みですがまだ使用されません
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDelete(c.provider)}
                  disabled={deletingProvider === c.provider}
                  className="pressable rounded-md border border-caution-border bg-caution-soft px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"
                >
                  {deletingProvider === c.provider ? "削除しています…" : "削除"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `${PROVIDER_LABELS[pendingDelete]}のAPIキーを削除します。よろしいですか?`
            : "APIキーを削除します。よろしいですか?"
        }
        confirmLabel="削除する"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
      />
    </div>
  );
}

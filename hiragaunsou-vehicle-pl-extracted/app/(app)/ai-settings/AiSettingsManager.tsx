"use client";

import { useState } from "react";
import {
  AI_PROVIDERS,
  type AiProvider,
  type AiProviderCredentialSummary,
} from "../../../src/domain/repositories/AiProviderCredentialRepository";
import { MODEL_CATALOG, defaultModelId } from "../../../src/domain/rules/aiModelCatalog";
import { ConfirmDialog } from "../../_components/ConfirmDialog";
import { AlertPanel } from "../../_components/AlertPanel";
import { Card, Prose } from "../../_components/Card";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "../../_components/formStyles";

/**
 * 呼び方は「プロバイダ」で統一する（長音を付けない・T7 §1-1）。
 * 括弧は全角（）を使う（T7 §1-4）。
 */
const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic（Claude）",
  openai: "OpenAI（ChatGPT）（未対応）",
  google: "Google（Gemini）（未対応）",
  xai: "xAI（Grok）（未対応）",
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

  /*
    T7 §4-1 の質問への答え。
      APIキーの登録 — 1件を読んで直す作業。列をまたいで見比べる場面ではないので
        表にせず、項目名と入力欄を縦に並べる。
      登録済みのAPIキー — プロバイダは最大4件で、1件ずつ「消すかどうか」を判断する。
        見比べる表ではなくカード（1件ずつの操作付き）にする。
  */
  return (
    <div className="flex flex-col gap-6">
      <Card title="APIキーを登録・上書きする">
        <Prose>
          登録済みのプロバイダも、この画面から再入力すると丸ごと上書きされます（部分編集はできません）。
        </Prose>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>プロバイダ</span>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
              className={FIELD_CLASS}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          {UNSUPPORTED_PROVIDERS.has(provider) ? (
            <AlertPanel tone="caution" title="このプロバイダはまだ使われません">
              現在このプロバイダは未対応です（近日対応予定）。APIキーを保存すること自体は可能ですが、
              AI要因分析などの機能からはまだ呼び出されず、保存しても利用されません。
            </AlertPanel>
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

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>APIキー</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={existing ? `登録済み（末尾 ${existing.apiKeyLast4}）を上書きする場合のみ入力` : "sk-..."}
              autoComplete="off"
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>モデル</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className={FIELD_CLASS}>
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

          {/* 失敗は注意(caution)ではなく danger で出す。色は意味にだけ使う。 */}
          {saveState.status === "error" ? (
            <AlertPanel tone="danger" title="保存できませんでした">
              {saveState.message}
            </AlertPanel>
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
      </Card>

      <Card title="登録済みのAPIキー">
        {credentials.length === 0 ? (
          <Prose>
            APIキーがまだ1件も登録されていないため、一覧は空です。
            上の「APIキーを登録・上書きする」でプロバイダとキーを入れると、ここに出ます。
          </Prose>
        ) : (
          <div className="flex flex-col">
            {credentials.map((c) => (
              <div
                key={c.provider}
                className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{PROVIDER_LABELS[c.provider]}</p>
                  <p className="text-xs text-ink-muted">
                    末尾 {c.apiKeyLast4} / {c.model} / 更新: {new Date(c.updatedAt).toLocaleString("ja-JP")}
                    {c.updatedBy ? `（${c.updatedBy}）` : ""}
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
                  className="btn btn-danger btn-sm pressable"
                >
                  {deletingProvider === c.provider ? "削除しています…" : "この接続を削除する"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

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

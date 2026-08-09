"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 一覧の中の1項目を、その場で直せるようにする小さな入力欄。
 *
 * これまでマスタを直す手段はファイルの入れ直しだけで、1名の車番を直したいだけでも
 * 全件のファイルを作り直す必要があった。1項目だけを直せる道をここで用意する。
 *
 * 反映の決まりは他の直しと同じ:
 *   まだ締めていない月 → その場で収支表に反映
 *   締めた月           → 据え置き、「直した内容の反映」の画面に食い違いとして並ぶ
 */
export function MasterFieldEditor({
  targetKind,
  targetKey,
  field,
  label,
  value,
  placeholder,
  emptyText = "未入力",
}: {
  targetKind: "vehicle" | "driver";
  /** 車番 または 社員No */
  targetKey: string;
  field: string;
  /** 何を直しているかを画面に出すための項目名 */
  label: string;
  value: string | null;
  placeholder?: string;
  /** 値が空のときに出す文字 */
  emptyText?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/master-changes/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind, targetKey, field, value: draft }),
      });
      const data = (await res.json()) as {
        error?: string;
        applied?: string[];
        heldBack?: string[];
      };
      if (!res.ok || data.error) {
        setError(data.error ?? "直せませんでした");
        return;
      }
      setEditing(false);
      // 締めた月があるなら、そこは据え置いたことを必ず伝える。黙って据え置くと
      // 「直したのに古い数字のまま」に見える。
      setDone(
        (data.heldBack ?? []).length > 0
          ? `直しました。締めた月(${(data.heldBack ?? []).join("・")})はそのままです`
          : "直しました",
      );
      router.refresh();
    } catch {
      setError("通信できませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-baseline gap-2">
        <span>{value ? value : <span className="text-ink-muted">{emptyText}</span>}</span>
        <button
          type="button"
          className="text-xs underline text-brand-deep"
          onClick={() => {
            setDraft(value ?? "");
            setDone(null);
            setEditing(true);
          }}
        >
          直す
        </button>
        {done ? <span className="text-xs text-brand-deep">{done}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <label className="sr-only" htmlFor={`${targetKind}-${targetKey}-${field}`}>
        {label}
      </label>
      <input
        id={`${targetKind}-${targetKey}-${field}`}
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        /*
          数字の欄 (NumberEntryField) と同じく、Enterで確定できるようにする。
          IME確定のEnterでは保存しない (変換途中で送ってしまうため)。
        */
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (!busy) void save();
        }}
        className="w-28 rounded-md border border-line px-2 py-1 text-sm"
      />
      <button
        type="button"
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "直しています…" : "保存"}
      </button>
      <button
        type="button"
        className="text-xs underline"
        disabled={busy}
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
      >
        やめる
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}

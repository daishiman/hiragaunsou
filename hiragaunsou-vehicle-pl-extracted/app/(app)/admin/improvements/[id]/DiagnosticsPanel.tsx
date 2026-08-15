import type { StoredDiagnostics } from "../../../../../src/domain/rules/diagnostics";

/**
 * 送信時に裏で集めた記録を管理者に見せる。
 *
 * 既定は全て閉じておく。ここに出るものの大半は、普段は読む必要がない。
 * 開かないと読めない代わりに、「どこを開けば何があるか」は見出しで分かるようにする。
 * 何も無いときも枠は残し、「取れなかった」と書く
 * (枠ごと消すと、集め忘れなのか本当に何も無かったのかが区別できない)。
 */
export function DiagnosticsPanel({ d }: { d: StoredDiagnostics | null }) {
  if (!d) {
    return (
      <div className="card mt-3 px-4 py-4">
        <p className="text-xs font-semibold text-ink">送信時の記録</p>
        <p className="mt-1 text-xs text-ink-muted">
          この要望には記録が付いていません（この仕組みを入れる前に送られた要望です）。
        </p>
      </div>
    );
  }

  return (
    <div className="card mt-3 px-4 py-4">
      <p className="text-xs font-semibold text-ink">送信時の記録</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        送った人には入力させず、ブラウザが知っていることを自動で集めたものです。
        パスワード・メールアドレスなどは自動で伏せられています。
      </p>

      <dl className="mt-3 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
        <Row label="発生時刻（JST）" value={d.occurredAt.jst} />
        <Row label="発生時刻（UTC）" value={d.occurredAt.utc} />
        <Row label="直すファイル（推定）" value={d.screen.sourceFile} />
        <Row label="遷移元" value={d.referrer} />
        <Row label="アプリの版" value={d.build.id} />
        <Row label="送った人の権限" value={d.reporter.role} />
      </dl>

      {d.notes.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-ink">
          記録についての注記: {d.notes.join(" / ")}
        </p>
      )}

      <Section title={`環境（${d.environment.browser} / ${d.environment.os}）`}>
        <dl className="grid gap-1 sm:grid-cols-2">
          <Row label="ブラウザ" value={d.environment.browser} />
          <Row label="OS" value={d.environment.os} />
          <Row label="画面の大きさ" value={d.environment.viewport} />
          <Row label="表示倍率" value={String(d.environment.devicePixelRatio)} />
          <Row label="タッチ操作" value={boolText(d.environment.touch)} />
          <Row label="言語" value={d.environment.language} />
          <Row label="タイムゾーン" value={d.environment.timezone} />
          <Row label="通信状態" value={boolText(d.environment.online, "オンライン", "オフライン")} />
          <Row label="UserAgent" value={d.environment.userAgent} />
        </dl>
      </Section>

      <Section title={`直近のエラー（例外 ${d.errors.length}件 / console ${d.console.length}件）`}>
        {d.errors.length === 0 && d.console.length === 0 ? (
          <p>記録されていません。</p>
        ) : (
          <>
            {d.errors.map((e, i) => (
              <div key={i} className="mb-2">
                <p className="font-semibold text-danger">
                  {e.kind === "uncaught" ? "例外" : "後始末されなかった非同期処理"}・{e.at}
                </p>
                <p>{e.message}</p>
                {e.source && <p className="text-ink-muted">発生場所: {e.source}</p>}
                {e.stack && <Pre text={e.stack} />}
              </div>
            ))}
            {d.console.map((c, i) => (
              <p key={i}>
                <span className="font-semibold">{c.level}</span> {c.at} — {c.message}
              </p>
            ))}
          </>
        )}
      </Section>

      <Section title={`失敗した通信（${d.network.length}件）`}>
        <NetworkList entries={d.network} empty="失敗した通信はありません。" />
      </Section>

      <Section title={`直近のAPI呼び出し（${d.api.length}件）`}>
        <NetworkList entries={d.api} empty="APIの呼び出しはありません。" />
      </Section>

      <Section title={`操作の足あと（${d.breadcrumbs.length}件）`}>
        {d.breadcrumbs.length === 0 ? (
          <p>記録されていません。</p>
        ) : (
          <ol className="list-decimal pl-5">
            {d.breadcrumbs.map((c, i) => (
              <li key={i}>
                {crumbLabel(c.kind)}: {c.target}
                <span className="text-ink-muted"> — {c.at}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-1 text-ink-muted">入力された値そのものは記録していません。</p>
      </Section>

      <Section title="速さ">
        <dl className="grid gap-1 sm:grid-cols-2">
          <Row label="ページの読み込み" value={msText(d.performance.pageLoadMs)} />
          <Row label="APIの中央値" value={msText(d.performance.medianApiMs)} />
          <Row
            label="一番遅かったAPI"
            value={
              d.performance.slowestApi
                ? `${d.performance.slowestApi.url}（${d.performance.slowestApi.durationMs}ms）`
                : "なし"
            }
          />
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="mt-2 rounded-[var(--radius-control)] border border-line px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-ink">{title}</summary>
      <div className="mt-2 text-xs break-words text-ink">{children}</div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-semibold">{label}: </dt>
      <dd className="inline break-all">{value}</dd>
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-[var(--radius-control)] bg-subtle p-2 text-[11px] whitespace-pre-wrap">
      {text}
    </pre>
  );
}

function NetworkList({
  entries,
  empty,
}: {
  entries: StoredDiagnostics["network"];
  empty: string;
}) {
  if (entries.length === 0) return <p>{empty}</p>;
  return (
    <ul className="grid gap-2">
      {entries.map((n, i) => (
        <li key={i}>
          <p>
            <span className="font-semibold">{n.method}</span> {n.url}
          </p>
          <p className="text-ink-muted">
            結果: {n.status ?? "通信できず"}・{n.durationMs}ms・
            {n.at}
            {n.requestId && `・request-id: ${n.requestId}`}
            {n.cfRay && `・cf-ray: ${n.cfRay}`}
          </p>
          {n.responseExcerpt && <p className="text-ink-muted">応答: {n.responseExcerpt}</p>}
        </li>
      ))}
    </ul>
  );
}

function boolText(value: boolean | string, yes = "はい", no = "いいえ"): string {
  if (value === true) return yes;
  if (value === false) return no;
  return value;
}

function msText(value: number | string): string {
  return typeof value === "number" ? `${value}ms` : value;
}

function crumbLabel(kind: StoredDiagnostics["breadcrumbs"][number]["kind"]): string {
  switch (kind) {
    case "navigate":
      return "画面を開く";
    case "submit":
      return "送信";
    case "input":
      return "入力";
    default:
      return "押す";
  }
}

/**
 * GitHub のトークンを用意するときの案内。
 *
 * 「トークンを入れてください」とだけ書くと、どこで作るのか・どの権限を付けるのかが
 * 分からず、たいてい権限を広く取ってしまう。広いトークンが1つあると、
 * 起票のためだけの鍵で、コードも設定も書き換えられる状態になる。
 * だから、取りに行く場所と付ける権限をこの1か所に書いて、必要なところから使い回す。
 *
 * トークンそのものは Workers のシークレットにだけ置く。画面から入力させないし、
 * 一度登録したものを画面へ出しもしない (出せる作りにした時点で、いつか漏れる)。
 */
export function GitHubTokenGuide() {
  return (
    <div className="mt-3 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs text-ink-muted">
      <p className="font-semibold text-ink">トークンの取り方（システム管理者向け）</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-deep underline"
          >
            fine-grained token を作る（推奨）
          </a>
          <br />
          対象リポジトリに<strong>起票先だけ</strong>を指定し、Repository permissions の{" "}
          <strong>Issues を Read and write</strong> にします。それ以外の権限は付けません。
        </li>
        <li>
          有効期限を設定した場合、<strong>期限が切れると起票が止まります</strong>
          （下書きの確認は続けてできます）。期限の日付を控えておいてください。
        </li>
        <li>
          作ったトークンは <code>wrangler secret put GITHUB_ISSUE_TOKEN</code> で登録します。
          コードや設定ファイルには書きません。登録後は画面にも出ません（控えは各自で保管してください）。
        </li>
        <li>
          画面の写しも Issue に貼りたい場合だけ、Contents を Read and write に足したうえで{" "}
          <code>GITHUB_ISSUE_ATTACH_SHOT=true</code> を設定します。
          既定は貼らない設定で、Issue には管理画面へのリンクが載ります。
        </li>
      </ol>
      <p className="mt-2">
        fine-grained token が使えない場合は{" "}
        <a
          href="https://github.com/settings/tokens/new?scopes=repo"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          classic token（repo スコープ）
        </a>{" "}
        でも動きますが、権限が広くなるため fine-grained を推奨します。
      </p>
    </div>
  );
}

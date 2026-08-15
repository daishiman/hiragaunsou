import type { IssueDraft } from "../../domain/rules/improvementIssue";

/**
 * 改善要望を GitHub Issue にする。
 *
 * 起票先とトークンは、設定されていなければ「未設定」として扱い、失敗にしない。
 * この機能は下書き (dry-run) だけでも十分に役に立つので、
 * 起票先が決まる前でも画面が壊れないようにしておく。
 *
 * トークンは Workers のシークレットからしか読まない。既定値を持たせない
 * (コードに書ける余地を作った時点で、いつか書かれる)。
 */

export interface GitHubIssueConfig {
  token: string;
  /** "owner/repo" の形。 */
  repo: string;
  /**
   * 画面の写しを Issue に貼るか。既定は false。
   *
   * 貼るにはリポジトリへファイルを置く必要があり、トークンに
   * Contents の書き込み権限が要る。既定の権限は Issues だけに絞ってあるので、
   * 「画像も貼りたい」と決めたときにだけ、権限と一緒にこれを入にする。
   * false のときも、Issue には管理画面への導線が必ず載る。
   */
  attachShot: boolean;
}

export interface IssuedResult {
  number: number;
  url: string;
}

/** 起票先の設定が揃っているかを見る。揃っていなければ null (下書きだけ使える)。 */
export function githubIssueConfigOf(env: unknown): GitHubIssueConfig | null {
  const src = (typeof env === "object" && env !== null ? env : {}) as Record<string, unknown>;
  const token = typeof src.GITHUB_ISSUE_TOKEN === "string" ? src.GITHUB_ISSUE_TOKEN.trim() : "";
  const repo = typeof src.GITHUB_ISSUE_REPO === "string" ? src.GITHUB_ISSUE_REPO.trim() : "";
  // owner/repo 以外の形は受け付けない。打ち間違いのまま他人のリポジトリへ
  // 業務の中身を投げてしまう事故を、実行前に止める。
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  // 既定は「貼らない」。明示的に true と書いたときだけ入にする。
  const attachShot = String(src.GITHUB_ISSUE_ATTACH_SHOT ?? "").trim().toLowerCase() === "true";
  return { token, repo, attachShot };
}

export class GitHubIssueError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubIssueError";
  }
}

/** 画像を置く場所。1つの要望につき1枚なので、要望のIDをそのままファイル名にする。 */
export function shotPathOf(improvementId: string): string {
  return `improvement-shots/${improvementId}.jpg`;
}

export class GitHubIssueClient {
  constructor(private readonly config: GitHubIssueConfig) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "hiragaunsou-vehicle-pl",
      "x-github-api-version": "2022-11-28",
    };
  }

  /**
   * 書き込みを焼き込んだ画像を、起票先のリポジトリへ1枚置く。
   *
   * 置くのは、書き込み後の1枚だけ (元画像は手元にも残していない)。
   * 失敗しても null を返して起票そのものは続ける。画像が貼れないことより、
   * 要望が届かないことの方が困る。見る道は管理画面のリンクが残る。
   */
  async uploadShot(improvementId: string, dataUrl: string): Promise<string | null> {
    if (!this.config.attachShot) return null;
    const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : "";
    if (!base64) return null;

    const path = shotPathOf(improvementId);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${this.config.repo}/contents/${path}`,
        {
          method: "PUT",
          headers: this.headers(),
          body: JSON.stringify({
            message: `改善要望 ${improvementId} の画面の写しを追加`,
            content: base64,
          }),
        },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { content?: { html_url?: unknown } };
      const htmlUrl = json.content?.html_url;
      // 表示用のURL。private なリポジトリでは画像が直接は展開されないので、
      // 本文側でリンクも併記する (improvementIssue.ts の shotSection)。
      return typeof htmlUrl === "string" ? `${htmlUrl}?raw=1` : null;
    } catch {
      return null;
    }
  }

  async create(draft: IssueDraft): Promise<IssuedResult> {
    const res = await fetch(`https://api.github.com/repos/${this.config.repo}/issues`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
      }),
    });

    if (!res.ok) {
      // 応答の中身は外へ出さない。トークンの取り違えのときに、
      // GitHub が返す文言をそのまま画面へ出すと余計なことまで見えてしまう。
      const hint =
        res.status === 401 || res.status === 403
          ? "GitHubへの接続が断られました。トークンの権限と有効期限を確認してください。"
          : res.status === 404
            ? "起票先のリポジトリが見つかりません。設定を確認してください。"
            : res.status === 422
              ? "Issueの内容をGitHubが受け付けませんでした（ラベルが無い可能性があります）。"
              : "GitHubへ起票できませんでした。時間をおいてお試しください。";
      throw new GitHubIssueError(hint, res.status);
    }

    const json = (await res.json()) as { number?: unknown; html_url?: unknown };
    if (typeof json.number !== "number" || typeof json.html_url !== "string") {
      throw new GitHubIssueError("GitHubの応答を読み取れませんでした。", 502);
    }
    return { number: json.number, url: json.html_url };
  }
}

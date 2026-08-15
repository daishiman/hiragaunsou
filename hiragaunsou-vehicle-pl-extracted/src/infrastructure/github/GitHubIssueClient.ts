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
  return { token, repo };
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

export class GitHubIssueClient {
  constructor(private readonly config: GitHubIssueConfig) {}

  async create(draft: IssueDraft): Promise<IssuedResult> {
    const res = await fetch(`https://api.github.com/repos/${this.config.repo}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "hiragaunsou-vehicle-pl",
        "x-github-api-version": "2022-11-28",
      },
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

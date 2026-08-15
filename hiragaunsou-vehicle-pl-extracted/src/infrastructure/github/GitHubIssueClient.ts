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

/**
 * GitHub 側の Issue の状態。missing は「消された・見つからない」。
 * 消えた番号を持ち続けると、その要望は以後ずっと更新も作成もできなくなるため、
 * 見つからないことを1つの状態として持つ。
 */
export type RemoteIssueState = "open" | "closed" | "missing";

/** 混み合っているときに待つ時間。段階的に延ばす (すぐ叩き直すと余計に断られる)。 */
const RETRY_WAIT_MS = [1_000, 4_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHubIssueClient {
  constructor(private readonly config: GitHubIssueConfig) {}

  /**
   * GitHub へ1回投げる。混み合って断られたときだけ待って投げ直す。
   *
   * 一括で何十件も続けて投げると、GitHub は 429 や 403 (secondary rate limit) で
   * 断ってくる。ここで待って投げ直さないと、一括の後半だけが理由もなく失敗する。
   * ただし何度も粘らない。粘るほど制限は長くなるので、2回までにして、
   * それでも駄目なら理由を持って上へ返す (握り潰さず行に出す)。
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(url, init);
      const retryable =
        res.status === 429 ||
        (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
      if (!retryable || attempt >= RETRY_WAIT_MS.length) return res;

      const header = res.headers.get("retry-after");
      const fromHeader = header && /^\d+$/.test(header) ? Number(header) * 1000 : 0;
      // 待てと言われた時間が長すぎる場合は待たずに返す (画面を何分も止めない)。
      if (fromHeader > 30_000) return res;
      await sleep(Math.max(fromHeader, RETRY_WAIT_MS[attempt] ?? 1_000));
    }
  }

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

  /** 応答の中身は外へ出さない。GitHub が返す文言をそのまま画面へ出すと余計なことまで見えてしまう。 */
  private fail(status: number, what: string): GitHubIssueError {
    const hint =
      status === 401 || status === 403
        ? "GitHubへの接続が断られました。トークンの権限と有効期限を確認してください。"
        : status === 404
          ? "起票先のリポジトリまたはIssueが見つかりません。設定を確認してください。"
          : status === 422
            ? "Issueの内容をGitHubが受け付けませんでした（ラベルが無い可能性があります）。"
            : status === 429
              ? "GitHubが混み合っています。少し時間をおいて、残りだけ送り直してください。"
              : `GitHubへ${what}できませんでした。時間をおいてお試しください。`;
    return new GitHubIssueError(hint, status);
  }

  async create(draft: IssueDraft): Promise<IssuedResult> {
    const res = await this.send(`https://api.github.com/repos/${this.config.repo}/issues`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
      }),
    });

    if (!res.ok) throw this.fail(res.status, "起票");

    const json = (await res.json()) as { number?: unknown; html_url?: unknown };
    if (typeof json.number !== "number" || typeof json.html_url !== "string") {
      throw new GitHubIssueError("GitHubの応答を読み取れませんでした。", 502);
    }
    return { number: json.number, url: json.html_url };
  }

  /**
   * 立ててある Issue の本文を最新に置き換える。
   *
   * 消えている (404) ときだけ例外にせず null を返す。GitHub 側で消された Issue を
   * 更新できないのは失敗ではなく、「立て直す必要がある」という事実だから。
   */
  async update(issueNumber: number, draft: IssueDraft): Promise<IssuedResult | null> {
    const res = await this.send(
      `https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
      },
    );
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw this.fail(res.status, "更新");
    const json = (await res.json()) as { number?: unknown; html_url?: unknown };
    if (typeof json.number !== "number" || typeof json.html_url !== "string") {
      throw new GitHubIssueError("GitHubの応答を読み取れませんでした。", 502);
    }
    return { number: json.number, url: json.html_url };
  }

  /**
   * 変更の内容を Issue のコメントとして残す。
   *
   * 失敗しても例外にしない。本文の更新は済んでいるので、開いた人は最新を読める。
   * 履歴の一言が残らないことより、本文の更新まで失敗扱いにして送り直させる方が害が大きい。
   */
  async comment(issueNumber: number, body: string): Promise<boolean> {
    try {
      const res = await this.send(
        `https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}/comments`,
        { method: "POST", headers: this.headers(), body: JSON.stringify({ body }) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Issue を閉じる。既に閉じているものへ投げても GitHub 側で何も起きない。 */
  async close(issueNumber: number): Promise<boolean> {
    const res = await this.send(
      `https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
      },
    );
    return res.ok;
  }

  /** Issue を開き直す。閉じたあとに「やっぱり直す」と決め直したときだけ使う。 */
  async reopen(issueNumber: number): Promise<boolean> {
    const res = await this.send(
      `https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ state: "open" }),
      },
    );
    return res.ok;
  }

  /**
   * GitHub 側で今どうなっているかを見る。
   * 読めなかったときは null を返し、呼び出し側が「分からない」まま進めるようにする
   * (状態を確かめられないことを、起票そのものの失敗にしない)。
   */
  async state(issueNumber: number): Promise<RemoteIssueState | null> {
    try {
      const res = await this.send(
        `https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}`,
        { method: "GET", headers: this.headers() },
      );
      if (res.status === 404 || res.status === 410) return "missing";
      if (!res.ok) return null;
      const json = (await res.json()) as { state?: unknown };
      return json.state === "closed" ? "closed" : "open";
    } catch {
      return null;
    }
  }
}

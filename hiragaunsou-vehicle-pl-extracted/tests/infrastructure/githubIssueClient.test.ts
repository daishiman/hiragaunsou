import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitHubIssueClient,
  GitHubIssueError,
  githubIssueConfigOf,
} from "../../src/infrastructure/github/GitHubIssueClient";

/**
 * GitHub への起票。
 *
 * 一番の関心は「打ち間違えた設定のまま、業務の中身を知らない場所へ投げないこと」。
 * だから設定の受け入れは厳しく、失敗の伝え方は控えめにする。
 */
describe("githubIssueConfigOf", () => {
  it("トークンと起票先が揃っていれば使える", () => {
    expect(
      githubIssueConfigOf({ GITHUB_ISSUE_TOKEN: "t", GITHUB_ISSUE_REPO: "daishiman/hiragaunsou" }),
    ).toEqual({ token: "t", repo: "daishiman/hiragaunsou", attachShot: false });
  });

  it("画像を貼るのは、はっきり true と書いたときだけ", () => {
    // 画像を貼るにはリポジトリへの書き込み権限が要る。
    // 既定を「貼る」にすると、要らない権限を持たせる設定が既定になってしまう。
    const base = { GITHUB_ISSUE_TOKEN: "t", GITHUB_ISSUE_REPO: "a/b" };
    expect(githubIssueConfigOf(base)?.attachShot).toBe(false);
    expect(githubIssueConfigOf({ ...base, GITHUB_ISSUE_ATTACH_SHOT: "1" })?.attachShot).toBe(false);
    expect(githubIssueConfigOf({ ...base, GITHUB_ISSUE_ATTACH_SHOT: "true" })?.attachShot).toBe(
      true,
    );
  });

  it("どちらかが無ければ未設定として扱う（機能を止めず、下書きだけ使える）", () => {
    expect(githubIssueConfigOf({ GITHUB_ISSUE_REPO: "a/b" })).toBeNull();
    expect(githubIssueConfigOf({ GITHUB_ISSUE_TOKEN: "t" })).toBeNull();
    expect(githubIssueConfigOf(undefined)).toBeNull();
    expect(githubIssueConfigOf({ GITHUB_ISSUE_TOKEN: "  ", GITHUB_ISSUE_REPO: "a/b" })).toBeNull();
  });

  it("owner/repo の形でなければ受け付けない（別のリポジトリへ投げる事故を止める）", () => {
    for (const repo of ["hiragaunsou", "https://github.com/a/b", "a/b/c", "a b"]) {
      expect(githubIssueConfigOf({ GITHUB_ISSUE_TOKEN: "t", GITHUB_ISSUE_REPO: repo }), repo).toBeNull();
    }
  });
});

describe("GitHubIssueClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  const draft = { title: "t", body: "b", labels: ["改善要望"] };

  it("番号とURLを返す", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 5, html_url: "https://github.com/a/b/issues/5" }), {
        status: 201,
      }),
    );
    const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
    expect(await client.create(draft)).toEqual({
      number: 5,
      url: "https://github.com/a/b/issues/5",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/a/b/issues");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  it("断られたときは、次にすることが分かる言葉で返す", async () => {
    fetchMock.mockResolvedValue(new Response("Bad credentials", { status: 403 }));
    const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
    await expect(client.create(draft)).rejects.toBeInstanceOf(GitHubIssueError);
    await expect(client.create(draft)).rejects.toThrow(/トークンの権限/);
  });

  it("起票先が無いときは設定を疑うよう伝える", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
    const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
    await expect(client.create(draft)).rejects.toThrow(/リポジトリまたはIssueが見つかりません/);
  });

  it("応答が読めないときも、成功として扱わない", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
    await expect(client.create(draft)).rejects.toThrow(/読み取れませんでした/);
  });

  describe("画面の写しの置き方", () => {
    const dataUrl = "data:image/jpeg;base64,QUJD";

    it("貼らない設定なら、置きに行かない（余計な権限を使わない）", async () => {
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
      expect(await client.uploadShot("improve_1", dataUrl)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("貼る設定なら、焼き込み済みの1枚だけを置く", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ content: { html_url: "https://github.com/a/b/blob/main/x.jpg" } }),
          { status: 201 },
        ),
      );
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: true });

      expect(await client.uploadShot("improve_1", dataUrl)).toBe(
        "https://github.com/a/b/blob/main/x.jpg?raw=1",
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.github.com/repos/a/b/contents/improvement-shots/improve_1.jpg");
      // data URL の頭は落として、中身だけを送る。
      expect(JSON.parse(String(init.body)).content).toBe("QUJD");
    });

    it("置けなくても起票は止めない（画像より、要望が届くことを優先する）", async () => {
      fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: true });
      expect(await client.uploadShot("improve_1", dataUrl)).toBeNull();
    });

    it("通信ごと落ちても起票は止めない", async () => {
      fetchMock.mockRejectedValue(new Error("offline"));
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: true });
      expect(await client.uploadShot("improve_1", dataUrl)).toBeNull();
    });

    it("画像の中身が読めない形なら置きに行かない", async () => {
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: true });
      expect(await client.uploadShot("improve_1", "中身なし")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("置けても応答にURLが無ければ、貼らずに進む", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ content: {} }), { status: 201 }));
      const client = new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: true });
      expect(await client.uploadShot("improve_1", dataUrl)).toBeNull();
    });
  });

  describe("立ててある Issue を扱う", () => {
    const client = () => new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });

    it("本文を最新に置き換える", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ number: 5, html_url: "https://github.com/a/b/issues/5" }), {
          status: 200,
        }),
      );
      expect(await client().update(5, draft)).toEqual({
        number: 5,
        url: "https://github.com/a/b/issues/5",
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.github.com/repos/a/b/issues/5");
      expect(init.method).toBe("PATCH");
    });

    it("Issue が消えていたら、失敗ではなく「立て直す必要がある」として返す", async () => {
      for (const status of [404, 410]) {
        fetchMock.mockResolvedValue(new Response("gone", { status }));
        expect(await client().update(5, draft), String(status)).toBeNull();
      }
    });

    it("更新を断られたら理由を持って上へ返す", async () => {
      fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
      await expect(client().update(5, draft)).rejects.toThrow(/更新できませんでした/);
    });

    it("更新の応答が読めないときも、成功として扱わない", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await expect(client().update(5, draft)).rejects.toThrow(/読み取れませんでした/);
    });

    it("コメントが残せなくても、本文の更新までは無かったことにしない", async () => {
      fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
      expect(await client().comment(5, "本文")).toBe(false);
      fetchMock.mockRejectedValue(new Error("offline"));
      expect(await client().comment(5, "本文")).toBe(false);
    });

    it("閉じる・開き直すは、結果を真偽で返す", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      expect(await client().close(5)).toBe(true);
      expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
        state: "closed",
      });
      expect(await client().reopen(5)).toBe(true);
      expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
        state: "open",
      });
      fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
      expect(await client().close(5)).toBe(false);
    });

    it("いまの状態を見る。読めなければ「分からない」として進める", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: "closed" }), { status: 200 }));
      expect(await client().state(5)).toBe("closed");
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
      expect(await client().state(5)).toBe("open");
      fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
      expect(await client().state(5)).toBe("missing");
      fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
      expect(await client().state(5)).toBeNull();
      fetchMock.mockRejectedValue(new Error("offline"));
      expect(await client().state(5)).toBeNull();
    });
  });

  describe("混み合って断られたとき", () => {
    const client = () => new GitHubIssueClient({ token: "t", repo: "a/b", attachShot: false });
    const ok = () =>
      new Response(JSON.stringify({ number: 5, html_url: "https://github.com/a/b/issues/5" }), {
        status: 201,
      });

    it("429 なら少し待って投げ直す（一括の後半だけ落ちないように）", async () => {
      vi.useFakeTimers();
      try {
        fetchMock
          .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
          .mockResolvedValueOnce(ok());
        const promise = client().create(draft);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await promise).toMatchObject({ number: 5 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("残り回数が尽きた 403 も、混み合いとして投げ直す", async () => {
      vi.useFakeTimers();
      try {
        fetchMock
          .mockResolvedValueOnce(
            new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
          )
          .mockResolvedValueOnce(ok());
        const promise = client().create(draft);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await promise).toMatchObject({ number: 5 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("何分も待てと言われたら、粘らずに理由を返す（画面を止めない）", async () => {
      fetchMock.mockResolvedValue(
        new Response("slow down", { status: 429, headers: { "retry-after": "600" } }),
      );
      await expect(client().create(draft)).rejects.toThrow(/混み合っています/);
      // 待たずに1回で切り上げる。
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("何度も粘らない（粘るほど制限は長くなる）", async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockResolvedValue(new Response("slow down", { status: 429 }));
        const promise = client().create(draft);
        const assertion = expect(promise).rejects.toThrow(/混み合っています/);
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

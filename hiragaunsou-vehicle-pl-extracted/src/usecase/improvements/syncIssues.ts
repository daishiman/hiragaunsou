import type {
  ImprovementDetail,
  ImprovementRepository,
} from "../../domain/repositories/ImprovementRepository";
import { buildIssueDraft, type IssueDraft } from "../../domain/rules/improvementIssue";
import {
  changeSummaryComment,
  issueContentHash,
  parseSyncedFields,
  planIssueSync,
  syncedFieldsOf,
  type IssueSyncPlan,
  type IssueSyncPlanItem,
} from "../../domain/rules/improvementIssueSync";
import { closingCommentOf, purgedCommentOf } from "../../domain/rules/improvementLifecycle";
import type { ImprovementStatus } from "../../domain/rules/improvement";
import {
  GitHubIssueClient,
  GitHubIssueError,
  shotPathOf,
} from "../../infrastructure/github/GitHubIssueClient";

/**
 * 改善要望を GitHub Issue へ送る処理。1件でも複数でも、必ずここを通る。
 *
 * 詳細画面の「Issueにする」と一覧の一括送信で処理を分けない。分けた時点で、
 * 片方にだけ入った守り (二重起票の防止・空更新の抑止・対象外の除外) が
 * もう片方から抜け、どちらを使ったかで結果が変わるようになる。
 *
 * 一括でも1件ずつ順番に投げる。並べて投げると GitHub の制限に当たりやすく、
 * さらに「どこまで進んだか」が失敗時に分からなくなる。順に投げて、
 * 成功した分はその場で確定させ、失敗した分だけを残す。
 */

/** 起票の権利を持てる時間。GitHubの応答待ちより十分長く、詰まったままにはならない長さ。 */
export const ISSUE_LEASE_MS = 60_000;

export interface IssueSyncDeps {
  repo: ImprovementRepository;
  /** 起票先が未設定なら null。下書きだけは作れる。 */
  client: GitHubIssueClient | null;
  /** 画面の写しを Issue へ貼る設定か。 */
  attachShot: boolean;
  /** "owner/repo"。下書きで貼付先を見せるためだけに使う。 */
  repoSlug: string | null;
  appOrigin: string;
  actorId: string;
  actorName: string;
}

export interface IssueSyncOptions {
  dryRun: boolean;
  /** GitHub 側で閉じている Issue を開き直すか。既定は開き直さない。 */
  reopenClosed?: boolean;
}

export interface IssueSyncResult extends IssueSyncPlanItem {
  ok: boolean;
  issueUrl: string | null;
  /** 実行後に画面へ出す一言。失敗した理由もここに入れる (握り潰さない)。 */
  message: string;
  /**
   * ほかの送信と競合して見送った場合。
   * 設定や通信の失敗と分けるのは、こちらは「少し待てば通る」ものだから。
   */
  conflict?: boolean;
}

export interface IssueSyncReport {
  plan: IssueSyncPlan;
  /** 下書き (dryRun のときだけ)。押す前に外へ出る中身を全部読ませる。 */
  drafts: { id: string; title: string; body: string; labels: string[] }[];
  results: IssueSyncResult[];
  configured: boolean;
}

interface Prepared {
  item: ImprovementDetail;
  draft: IssueDraft;
  hash: string;
}

/** 下書きを作る。画像を貼る設定なら、貼られる場所だけを先に入れる (置きには行かない)。 */
async function prepare(
  item: ImprovementDetail,
  deps: IssueSyncDeps,
): Promise<Prepared> {
  const shotUrl =
    deps.attachShot && item.hasShot && deps.repoSlug
      ? `https://github.com/${deps.repoSlug}/blob/HEAD/${shotPathOf(item.id)}?raw=1`
      : null;
  const draft = buildIssueDraft(item, { appOrigin: deps.appOrigin, shotUrl });
  return { item, draft, hash: await issueContentHash(draft) };
}

/**
 * 選ばれた件を Issue へ送る (dryRun なら計画と下書きだけ)。
 *
 * 呼び出し側が渡した順を守る。画面に並んでいる順と結果の順が違うと、
 * どの行が失敗したのかを目で追えない。
 */
export async function syncIssues(
  ids: string[],
  deps: IssueSyncDeps,
  options: IssueSyncOptions,
): Promise<IssueSyncReport> {
  const found = await deps.repo.findManyByIds(ids);
  const byId = new Map(found.map((i) => [i.id, i]));
  const items = ids.map((id) => byId.get(id)).filter((i): i is ImprovementDetail => i !== undefined);

  const prepared = await Promise.all(items.map((item) => prepare(item, deps)));
  const plan = planIssueSync(
    prepared.map((p) => ({
      id: p.item.id,
      screenLabel: p.item.screenLabel,
      status: p.item.status,
      archivedAt: p.item.archivedAt,
      githubIssueNumber: p.item.githubIssueNumber,
      githubIssueState: p.item.githubIssueState,
      storedHash: p.item.githubContentHash,
      nextHash: p.hash,
    })),
  );

  if (options.dryRun) {
    return {
      plan,
      drafts: prepared.map((p) => ({
        id: p.item.id,
        title: p.draft.title,
        body: p.draft.body,
        labels: p.draft.labels,
      })),
      results: [],
      configured: deps.client !== null,
    };
  }

  const results: IssueSyncResult[] = [];
  for (const planItem of plan.items) {
    const p = prepared.find((x) => x.item.id === planItem.id);
    if (!p) continue;

    if (planItem.kind === "excluded" || planItem.kind === "skip") {
      results.push({ ...planItem, ok: true, issueUrl: null, message: planItem.reason });
      continue;
    }
    if (!deps.client) {
      results.push({
        ...planItem,
        ok: false,
        issueUrl: null,
        message: "起票先の設定がまだありません。リポジトリとトークンを登録してください。",
      });
      continue;
    }
    results.push(
      planItem.kind === "create"
        ? await createOne(p, planItem, deps, deps.client)
        : await updateOne(p, planItem, deps, deps.client, options.reopenClosed === true),
    );
  }

  // 実行したときも下書きを返す。失敗したときに「何を送ろうとしたのか」が
  // 画面から読めないと、直しようがない。
  return {
    plan,
    drafts: prepared.map((p) => ({
      id: p.item.id,
      title: p.draft.title,
      body: p.draft.body,
      labels: p.draft.labels,
    })),
    results,
    configured: deps.client !== null,
  };
}

/** 新しく Issue を立てる。権利を取った1人だけが投げるので、同時に押されても2本にならない。 */
async function createOne(
  p: Prepared,
  planItem: IssueSyncPlanItem,
  deps: IssueSyncDeps,
  client: GitHubIssueClient,
): Promise<IssueSyncResult> {
  const id = p.item.id;

  // 見つからなくなった番号を握ったままだと、権利を取る条件 (番号が空) を満たせない。
  if (p.item.githubIssueNumber !== null) await deps.repo.detachIssue(id);

  const claimed = await deps.repo.beginIssuing(id, ISSUE_LEASE_MS);
  if (!claimed) {
    return {
      ...planItem,
      ok: false,
      issueUrl: null,
      conflict: true,
      message: "いま別の送信が動いています。少し待ってから、この行だけ送り直してください。",
    };
  }

  try {
    // 画像は起票の直前に置く。下書きの段階で置くと、確認しただけで外へ出てしまう。
    let shotUrl: string | null = null;
    if (deps.attachShot && p.item.hasShot) {
      const dataUrl = await deps.repo.findShot(id);
      if (dataUrl) shotUrl = await client.uploadShot(id, dataUrl);
    }
    const draft = shotUrl
      ? buildIssueDraft(p.item, { appOrigin: deps.appOrigin, shotUrl })
      : p.draft;
    const hash = shotUrl ? await issueContentHash(draft) : p.hash;

    const issued = await client.create(draft);
    const saved = await deps.repo.markIssued(id, {
      issueNumber: issued.number,
      issueUrl: issued.url,
      issuedById: deps.actorId,
      contentHash: hash,
      syncedFields: JSON.stringify(syncedFieldsOf(p.item)),
    });
    if (!saved) {
      // 立ったのに結び付かなかった場合。番号を握り潰すと迷子の Issue になる。
      return {
        ...planItem,
        ok: false,
        issueNumber: issued.number,
        issueUrl: issued.url,
        message: `Issue #${issued.number} は作成されましたが、要望との結び付けに失敗しました。重複していないか確認してください。`,
      };
    }
    await deps.repo.appendAudit([
      {
        requestId: id,
        actorId: deps.actorId,
        actorName: deps.actorName,
        action: "issue_create",
        fromStatus: null,
        toStatus: null,
        reason: `Issue #${issued.number}`,
      },
    ]);
    return {
      ...planItem,
      ok: true,
      issueNumber: issued.number,
      issueUrl: issued.url,
      message: `Issue #${issued.number} を作成しました。`,
    };
  } catch (e) {
    await deps.repo.releaseIssuing(id);
    return {
      ...planItem,
      ok: false,
      issueUrl: null,
      message: e instanceof GitHubIssueError ? e.message : "GitHubへ起票できませんでした。",
    };
  }
}

/** 立ててある Issue を最新に置き換え、何が変わったかをコメントに残す。 */
async function updateOne(
  p: Prepared,
  planItem: IssueSyncPlanItem,
  deps: IssueSyncDeps,
  client: GitHubIssueClient,
  reopenClosed: boolean,
): Promise<IssueSyncResult> {
  const id = p.item.id;
  const number = p.item.githubIssueNumber;
  if (number === null) {
    return { ...planItem, ok: false, issueUrl: null, message: "Issue番号がありません。" };
  }

  try {
    const updated = await client.update(number, p.draft);
    if (!updated) {
      // GitHub 側で消えていた。番号を外して、次に送ったときに立て直せるようにする。
      await deps.repo.detachIssue(id);
      return {
        ...planItem,
        ok: false,
        issueUrl: null,
        message: `Issue #${number} が見つかりませんでした。結び付きを外したので、もう一度送ると新しく立て直します。`,
      };
    }

    const before = parseSyncedFields(p.item.githubSyncedFields);
    const after = syncedFieldsOf(p.item);
    // 本文は最新に置き換え、変わった点はコメントで残す。片方だけだと
    // 「最新が読めない」か「履歴が消える」のどちらかになる。
    await client.comment(number, changeSummaryComment(before, after, deps.actorName));

    let state: string | null = p.item.githubIssueState;
    if (reopenClosed && p.item.githubIssueState === "closed") {
      if (await client.reopen(number)) state = "open";
    }

    await deps.repo.markIssueSynced(id, {
      contentHash: p.hash,
      syncedFields: JSON.stringify(after),
      state,
    });
    await deps.repo.appendAudit([
      {
        requestId: id,
        actorId: deps.actorId,
        actorName: deps.actorName,
        action: "issue_update",
        fromStatus: before?.status ?? null,
        toStatus: after.status,
        reason: `Issue #${number}`,
      },
    ]);
    return {
      ...planItem,
      ok: true,
      issueUrl: updated.url,
      message:
        state === "closed"
          ? `Issue #${number} を更新しました（閉じたままです）。`
          : `Issue #${number} を更新しました。`,
    };
  } catch (e) {
    return {
      ...planItem,
      ok: false,
      issueUrl: null,
      message: e instanceof GitHubIssueError ? e.message : "GitHubのIssueを更新できませんでした。",
    };
  }
}

/**
 * 見送り・誤作成・重複・廃棄にしたものの Issue を閉じる。
 *
 * 閉じられなくても、状態の変更そのものは成功として扱う。GitHub が落ちているせいで
 * 管理画面の整理ができなくなる方が困る。閉じられなかったことは呼び出し側が画面に出す。
 */
export async function closeIssueFor(
  input: {
    issueNumber: number;
    status: ImprovementStatus;
    archived: boolean;
    reason: string | null;
    parentIssueNumber: number | null;
  },
  deps: { client: GitHubIssueClient | null; actorName: string },
): Promise<{ closed: boolean; message: string }> {
  if (!deps.client) return { closed: false, message: "起票先が未設定のため Issue は閉じていません。" };
  try {
    await deps.client.comment(
      input.issueNumber,
      closingCommentOf({
        status: input.status,
        archived: input.archived,
        reason: input.reason,
        parentIssueNumber: input.parentIssueNumber,
        actorName: deps.actorName,
      }),
    );
    const closed = await deps.client.close(input.issueNumber);
    return {
      closed,
      message: closed
        ? `Issue #${input.issueNumber} を閉じました。`
        : `Issue #${input.issueNumber} を閉じられませんでした。GitHub側で閉じてください。`,
    };
  } catch {
    return {
      closed: false,
      message: `Issue #${input.issueNumber} を閉じられませんでした。GitHub側で閉じてください。`,
    };
  }
}

/**
 * 元データを完全削除したことを Issue に書き残す。Issue そのものは消さない。
 *
 * GitHub の Issue は通知も履歴も残り、消しても「無かったこと」にはできない。
 * 消せないものを消したふりをするより、元が無いことをその場に書く方が誠実で、
 * 後から管理画面のリンクを開いた人も迷わない。
 */
export async function notePurgedIssue(
  issueNumber: number,
  reason: string | null,
  deps: { client: GitHubIssueClient | null; actorName: string },
): Promise<void> {
  if (!deps.client) return;
  try {
    await deps.client.comment(
      issueNumber,
      purgedCommentOf({ actorName: deps.actorName, reason }),
    );
    await deps.client.close(issueNumber);
  } catch {
    // 書き残せなくても削除は止めない。消してほしいという求めの方が優先される。
  }
}

import type { ImprovementRepository } from "../../domain/repositories/ImprovementRepository";
import {
  GitHubIssueClient,
  githubIssueConfigOf,
} from "../../infrastructure/github/GitHubIssueClient";
import type { IssueSyncDeps } from "./syncIssues";

/**
 * 起票処理に渡す道具一式を、環境設定と操作した人から組み立てる。
 *
 * 単体・一括・状態変更のどの入口からも同じ組み立て方を使う。入口ごとに
 * 設定の読み方を書くと、片方だけ古い読み方のまま残って挙動がずれる。
 */
export function buildIssueSyncDeps(
  env: unknown,
  repo: ImprovementRepository,
  actor: { id: string; name: string },
): IssueSyncDeps {
  const config = githubIssueConfigOf(env);
  const appOrigin =
    typeof (env as { BETTER_AUTH_URL?: unknown })?.BETTER_AUTH_URL === "string"
      ? (env as { BETTER_AUTH_URL: string }).BETTER_AUTH_URL
      : "";
  return {
    repo,
    client: config ? new GitHubIssueClient(config) : null,
    attachShot: config?.attachShot === true,
    repoSlug: config?.repo ?? null,
    appOrigin,
    actorId: actor.id,
    actorName: actor.name,
  };
}

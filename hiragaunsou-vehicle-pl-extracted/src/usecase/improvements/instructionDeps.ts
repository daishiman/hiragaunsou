import type { ImprovementRepository } from "../../domain/repositories/ImprovementRepository";
import type { InstructionDeps } from "./publishInstructions";

/**
 * 指示文の発行・取得に渡す道具一式を、環境設定と操作した人から組み立てる。
 *
 * 単体・一括・取得のどの入口からも同じ組み立て方を使う。入口ごとに設定の読み方を
 * 書くと、片方だけ古い読み方のまま残って挙動がずれる。
 */
export function buildInstructionDeps(
  env: unknown,
  repo: ImprovementRepository,
  actor: { id: string; name: string },
): InstructionDeps {
  const e = env as { BETTER_AUTH_URL?: unknown; BETTER_AUTH_SECRET?: unknown };
  const appOrigin = typeof e?.BETTER_AUTH_URL === "string" ? e.BETTER_AUTH_URL : "";
  return {
    repo,
    appOrigin,
    shotSecret: shotSecretOf(env),
    actorId: actor.id,
    actorName: actor.name,
  };
}

/**
 * 画像の期限付きURLに署名する鍵。
 *
 * 新しいシークレットを増やさず、ログインの鍵から用途名を混ぜて作る。
 * 設定を1つ増やすと、登録し忘れたまま本番へ出て「画像だけ開けない」形で落ちる。
 * 用途名を混ぜるのは、同じ鍵で作った別の署名と取り違えられないようにするため。
 */
export function shotSecretOf(env: unknown): string {
  const base = (env as { BETTER_AUTH_SECRET?: unknown })?.BETTER_AUTH_SECRET;
  return `${typeof base === "string" ? base : ""}:improvement-shot`;
}

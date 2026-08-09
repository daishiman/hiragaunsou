import { getPlatformProxy } from "wrangler";
import { createAuth, type AuthEnv } from "../../../src/infrastructure/auth/auth";

/**
 * E2E専用のテストユーザー作成・削除ヘルパー。
 *
 * ログイン後の画面をPlaywrightで検証するには、本物のGoogle OAuthを経由しない
 * セッション発行手段が要る(docs/testing-strategy.md参照)。ここでは本番コードを
 * 一切変更せず、既存の招待経由メール/パスワード作成パス(app/api/admin/invitations/route.ts
 * が使っているのと同じ internalInviteProvisioning + auth.api.signUpEmail)をNode.js側から
 * 直接呼び出す。対象は `wrangler dev` 用のローカルD1のみ(getPlatformProxyはwrangler.jsonc
 * の bindings をローカルにエミュレートするだけで、本番D1には一切接続しない)。
 */

export type TestUserSpec = {
  email: string;
  password: string;
  name: string;
  role: "admin" | "input_staff" | "executive";
};

async function getLocalEnv() {
  const proxy = await getPlatformProxy();
  return { env: proxy.env as unknown as AuthEnv & { DB: D1Database }, dispose: proxy.dispose };
}

/**
 * ローカルD1は sqlite ファイル1つなので、preview サーバー(workerd)が動いたまま
 * getPlatformProxy から書き込むと SQLITE_BUSY で弾かれることがある。
 * 弾かれるのは一瞬の競合で、少し待てば必ず通る。ここで吸収しないと、
 * 準備・後片付けの失敗がテスト本体の失敗として報告されて原因を見失う。
 *
 * 同じ競合は `D1_ERROR: Failed to parse body as JSON, got: Error: internal error` の形でも
 * 出る(miniflare が sqlite の失敗をD1のエラー本文として返せずに落ちる)。文言が違うだけで
 * 待てば通る点は同じなので、こちらも待って作り直す。
 *
 * さらに better-auth を経由すると、元の SQLITE_BUSY はログに書かれるだけで、
 * 投げ直されるのは `APIError: Failed to create user` という別の文言になる。
 * 中身が見えないので、この文言自体を待てば通るものとして扱う。
 * (本当にスキーマが壊れている場合も数回試すが、待つのは合計1.5秒で済む)
 */
export async function withBusyRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await run();
    } catch (e) {
      const message = messageChainOf(e);
      const retryable =
        /SQLITE_BUSY|database is locked/i.test(message) ||
        /D1_ERROR|Failed to parse body as JSON|internal error/i.test(message) ||
        /Failed to create user|INTERNAL_SERVER_ERROR/i.test(message);
      if (i >= attempts || !retryable) throw e;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}

/**
 * 例外と、その原因(cause)を根までつないだ文字列。
 * D1の失敗は `DrizzleQueryError` → `cause: D1_ERROR` → `cause: SQLITE_BUSY` と
 * 二段三段に包まれて届くので、いちばん外側だけ見ると競合だと分からない。
 */
function messageChainOf(e: unknown): string {
  const parts: string[] = [];
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    parts.push(String(cur));
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

export async function createTestUser(spec: TestUserSpec): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    const auth = createAuth(env, {
      internalInviteProvisioning: { email: spec.email, role: spec.role },
    });
    await withBusyRetry(() =>
      auth.api.signUpEmail({
        body: { email: spec.email, password: spec.password, name: spec.name },
      }),
    );
  } finally {
    await dispose();
  }
}

/**
 * マスタ取込のE2Eが残す行を消す(テスト専用)。
 *
 * 対象を車番・社員Noで絞るのは、開発者がローカルで作った収支表やマスタを巻き込まないため。
 * 監査ログは user への外部キーを持つので、テストユーザーを消す前にここで消しておかないと
 * 後片付けが FOREIGN KEY constraint failed で落ちる。
 */
export async function clearMasterImportTestData(spec: {
  actorEmail: string;
  vehicleNos: readonly string[];
  employeeCodes: readonly string[];
  fileNames?: readonly string[];
}): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    // 取込の記録が残っていると、次の実行で「取り込み済みです」と出て1件目のテストが通らない。
    for (const fileName of spec.fileNames ?? []) {
      await withBusyRetry(() =>
        env.DB.prepare("DELETE FROM file_import_log WHERE file_name = ?").bind(fileName).run(),
      );
    }
    await withBusyRetry(() =>
      env.DB.prepare(
        "DELETE FROM admin_audit_log WHERE actor_id IN (SELECT id FROM user WHERE email = ?)",
      )
        .bind(spec.actorEmail)
        .run(),
    );
    const codes = spec.employeeCodes.map(() => "?").join(",");
    await withBusyRetry(() =>
      env.DB.prepare(`DELETE FROM driver_master WHERE employee_code IN (${codes})`)
        .bind(...spec.employeeCodes)
        .run(),
    );
    const nos = spec.vehicleNos.map(() => "?").join(",");
    /*
      テスト用の車番は、実データを入れたローカルでは他の行から参照されていることがある
      (運転者マスタの担当車両・トラクタのけん引先)。参照を残したまま消すと
      FOREIGN KEY constraint failed で後片付けが落ちる。かといって参照元まで消すと
      開発者がローカルに持っているデータを巻き込むので、参照だけを外して行は残す。
    */
    await withBusyRetry(() =>
      env.DB.prepare(`UPDATE driver_master SET vehicle_no = NULL WHERE vehicle_no IN (${nos})`)
        .bind(...spec.vehicleNos)
        .run(),
    );
    await withBusyRetry(() =>
      env.DB.prepare(
        `UPDATE vehicle_master SET towed_by_vehicle_no = NULL WHERE towed_by_vehicle_no IN (${nos})`,
      )
        .bind(...spec.vehicleNos)
        .run(),
    );
    await withBusyRetry(() =>
      env.DB.prepare(`DELETE FROM vehicle_master WHERE vehicle_no IN (${nos})`)
        .bind(...spec.vehicleNos)
        .run(),
    );
  } finally {
    await dispose();
  }
}

/**
 * user.id を指す外部キーのうち、cascade で消えないもの(「誰がやったか」の記録)。
 * 消し忘れると次回の beforeAll でユーザーを消せず FOREIGN KEY constraint failed になる。
 * 画面を操作した副作用(例: 保存で率マスタに月別行ができる)まで各specが把握するのは無理なので、
 * ここで一括して参照を外す。
 */
const USER_REFERENCES: ReadonlyArray<{ table: string; column: string; nullable: boolean }> = [
  { table: "csv_import_batch", column: "imported_by", nullable: true },
  { table: "rate_master", column: "updated_by", nullable: true },
  { table: "review_flag", column: "resolved_by", nullable: true },
  { table: "usage_log", column: "recorded_by", nullable: true },
  { table: "annual_reference", column: "updated_by", nullable: true },
  { table: "manual_vehicle_input", column: "updated_by", nullable: true },
  { table: "cleansing_decision", column: "decided_by", nullable: true },
  { table: "app_setting", column: "updated_by", nullable: true },
  { table: "ai_provider_credential", column: "updated_by", nullable: true },
  { table: "deficit_factor_analysis", column: "updated_by", nullable: true },
  { table: "user_invitation", column: "invited_by", nullable: false },
  { table: "admin_audit_log", column: "actor_id", nullable: true },
  { table: "vehicle_pl_override", column: "updated_by", nullable: true },
  { table: "pl_issue_ack", column: "acked_by", nullable: true },
  { table: "file_import_log", column: "imported_by", nullable: true },
];

/**
 * テストユーザーを削除する。
 * session/account は user.id への onDelete cascade で一緒に消えるが、
 * 「誰が更新したか」を持つ表は残るため、先に参照を外す(消せない列は行ごと落とす)。
 */
export async function deleteTestUserByEmail(email: string): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    const owner = `(SELECT id FROM user WHERE email = ?)`;
    await withBusyRetry(() =>
      env.DB.batch([
        ...USER_REFERENCES.map(({ table, column, nullable }) =>
          env.DB.prepare(
            nullable
              ? `UPDATE ${table} SET ${column} = NULL WHERE ${column} IN ${owner}`
              : `DELETE FROM ${table} WHERE ${column} IN ${owner}`,
          ).bind(email),
        ),
        env.DB.prepare("DELETE FROM user WHERE email = ?").bind(email),
      ]),
    );
  } finally {
    await dispose();
  }
}

/**
 * ローカルD1の rate_limit テーブルを全消去する(テスト専用)。
 * better-authの既定sign-inレート制限はIPベースのため、直列実行でも
 * テストごとに新規ユーザーでsign-inを繰り返すとすぐ429になる。
 * 各describeのbeforeAllで1回だけ呼び、以降はCookie使い回しでsign-in回数自体を減らす。
 */
export async function clearRateLimits(): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    await withBusyRetry(() => env.DB.prepare("DELETE FROM rate_limit").run());
  } finally {
    await dispose();
  }
}

export async function setUserBanned(email: string, banned: boolean): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    await withBusyRetry(() =>
      env.DB.prepare("UPDATE user SET banned = ? WHERE email = ?")
        .bind(banned ? 1 : 0, email)
        .run(),
    );
  } finally {
    await dispose();
  }
}

/**
 * email/passwordで実際にサインインし、Set-CookieヘッダーからセッションCookie文字列を得る。
 *
 * sign-in はサーバー側でセッション行とレート制限行を書くので、ここもD1の競合に当たる。
 * その場合サーバーは 500 を返す。待てば通るので数回試す。
 * 401(パスワード違い)・403(凍結)・429(レート制限)は待っても変わらないので、すぐ throw して
 * 「何が起きたか」をそのまま出す。
 */
export async function signInAndGetSetCookie(
  baseURL: string,
  email: string,
  password: string,
): Promise<string> {
  return withBusyRetry(async () => {
    const res = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.text();
      // 500 だけ「待てば通る」印を文言に混ぜて、上の withBusyRetry に拾わせる
      const busy = res.status >= 500 ? " SQLITE_BUSY(サーバー側の一時的な失敗として再試行)" : "";
      throw new Error(`sign-in failed: ${res.status} ${body}${busy}`);
    }
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("sign-in response did not include Set-Cookie");
    }
    return setCookie;
  });
}

import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { verifyGoogleIdToken, type GoogleProfile } from "better-auth/social-providers";
import { decodeJwt } from "jose";
import * as authSchema from "../db/auth-schema";
import { userInvitation } from "../db/schema";
import type { Role } from "../../domain/rules/permissions";

/**
 * 認証: Google Workspace 限定ログイン (Better Auth) — Next.js + OpenNext for Cloudflare 版。
 * - 許可ドメインは複数指定可能(カンマ区切りの WORKSPACE_DOMAINS)。将来的に協力会社等のドメインを
 *   追加できるよう、単一文字列(better-authのsocialProviders.google.hdは単一ドメイン比較のみ対応)
 *   ではなく、Setによる許可リスト判定を getUserInfo/verifyIdToken のオーバーライドで行う。
 * - 検証は常に Google 署名済みIDトークンの hd claim に対して行う。メールドメインの文字列比較は使わない
 *   (better-auth-google-gate スキルの不変条件)。
 * - D1バインディングはリクエスト単位で OpenNext の getCloudflareContext() から取得し、
 *   都度 createAuth(env) を呼ぶ(モジュールスコープにDB接続やAuthインスタンスを固定しない)。
 */
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WORKSPACE_DOMAINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * カンマ区切りのメールアドレス一覧。初回ログイン(アカウント作成)時にこの一覧へ
   * 一致するとロールを自動的に admin にする(初期管理者のブートストラップ用)。
   * 未設定・空なら誰も自動昇格しない。
   */
  BOOTSTRAP_ADMIN_EMAILS?: string;
};

export type CreateAuthOptions = {
  /**
   * 管理者によるメール/パスワード招待(authMethod="password")で、まだ実アカウントが存在しない
   * メールアドレスへ、サーバー側から直接 signUpEmail を呼んでuser+credential(account)行を
   * 作成する内部プロビジョニング専用。設定すると、対象メールに限り emailAndPassword.disableSignUp を
   * 一時的に無効化し、user.create.beforeフックのemailVerified必須チェックをスキップして
   * 指定ロール・emailVerified=trueで作成する。
   *
   * この経路は/api/admin/invitations(manage_users権限 + CSRFチェック済み)からしか呼ばれない
   * サーバー間呼び出し専用であり、公開HTTPエンドポイントには一切公開しない。
   * 対象メール以外はこのオプションを設定していても通常どおりACCESS_DENIEDになる(defense-in-depth)。
   */
  internalInviteProvisioning?: { email: string; role: Role };
};

/** カンマ区切りのメールアドレス一覧を正規化してSetにする(空要素は除外、大文字小文字を無視)。 */
export function parseBootstrapAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/** カンマ区切りの許可ドメイン一覧を正規化してSetにする(空要素は除外、大文字小文字を無視)。 */
export function parseAllowedWorkspaceDomains(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0),
  );
}

/**
 * Google署名済みIDトークンの hd claim が許可ドメインSetに含まれるかを判定する。
 * 許可リストが空の場合は fail-closed(誰も通さない)。
 */
export function isWorkspaceHostedDomainAllowed(
  allowedDomains: Set<string>,
  hostedDomain: unknown,
): boolean {
  if (allowedDomains.size === 0) return false;
  if (typeof hostedDomain !== "string" || hostedDomain.length === 0) return false;
  return allowedDomains.has(hostedDomain.toLowerCase());
}

export function createAuth(env: AuthEnv, options: CreateAuthOptions = {}) {
  const allowedDomains = parseAllowedWorkspaceDomains(env.WORKSPACE_DOMAINS);
  const bootstrapAdminEmails = parseBootstrapAdminEmails(env.BOOTSTRAP_ADMIN_EMAILS);
  const db = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    // D1に対話型トランザクションは無い(cloudflare-secure-deploy §4の鉄則)ため transaction: false 必須。
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
        // better-authの`hd`オプションは単一ドメイン比較のみ対応のため使わず、
        // getUserInfo/verifyIdTokenをオーバーライドして許可ドメインSetで検証する。
        // どちらもGoogleから直接得た(TLS経由・未改ざん)IDトークンのhd claimを見る。
        // 個人Gmail・許可外ドメイン・グループアドレスはhd不一致で拒否される。
        async getUserInfo(token) {
          if (!token.idToken) return null;
          const profile = decodeJwt(token.idToken) as GoogleProfile;
          if (!isWorkspaceHostedDomainAllowed(allowedDomains, profile.hd)) {
            // 拒否理由をログに残す。hd は組織ドメイン名でありメールアドレス等の個人情報は含めない。
            // これが無いと callback は unable_to_get_user_info としか言わず、原因究明が不可能になる。
            console.warn(
              `Google sign-in rejected: hosted domain "${profile.hd ?? "<none>"}" is not in WORKSPACE_DOMAINS.`,
            );
            return null;
          }
          return {
            user: {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
              emailVerified: profile.email_verified,
            },
            data: profile,
          };
        },
        async verifyIdToken(idToken, nonce) {
          const jwtClaims = await verifyGoogleIdToken({
            token: idToken,
            audience: env.GOOGLE_CLIENT_ID,
            nonce,
          });
          if (!jwtClaims) return false;
          return isWorkspaceHostedDomainAllowed(allowedDomains, jwtClaims.hd);
        },
      },
    },
    // メール/パスワード認証(Gmailを持たない社内ユーザー向け)。
    // 公開の自己サインアップは提供しない(disableSignUp: true、既定)。アカウントは必ず管理者が
    // /admin/users からの招待(authMethod="password")経由で /api/admin/invitations が
    // internalInviteProvisioningを使ってサーバー間で signUpEmail を呼び出す(管理者が画面で
    // 直接入力した初期パスワードで作成する)ことでのみ作成される。メール送信基盤を持たないため、
    // パスワードリセット(忘れた場合のメール再設定)は提供しない。パスワード変更は本人が
    // /profile 画面から現在のパスワードを使って行う(changePassword、本人確認済みの操作のみ)。
    // ハッシュ化は better-auth 標準機構に任せ、独自実装はしない。
    emailAndPassword: {
      enabled: true,
      // 公開の自己サインアップは常に禁止する。唯一の例外は internalInviteProvisioning が
      // 設定された、管理者操作由来のサーバー間呼び出しのみ(下のuser.create.beforeフックが
      // 対象メール以外を追加でブロックするため、二重にfail-closed)。
      disableSignUp: !options.internalInviteProvisioning,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      // internalInviteProvisioning経由のsignUpEmailで、管理者が指定した初期パスワードのまま
      // 誤ってその場でセッションが発行されないようにする(実際のログインは本人による明示的な
      // サインインのみ)。
      autoSignIn: false,
    },
    // OAuthコールバックが失敗したときの遷移先。
    // 既定のままだと Better Auth は /api/auth/error に飛ばし、そこは本番(NODE_ENV=production)で
    // 問答無用に `/?error=...` へ302する。`/` は未ログインなので /sign-in へリダイレクトされ、
    // 利用者から見ると「認証したのにサインイン画面に戻る」だけで理由が一切表示されない。
    // 明示的に /sign-in を指定し、error クエリを添えて理由を画面に出せるようにする。
    onAPIError: { errorURL: "/sign-in" },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // hd (Workspace限定) を通過しても未検証メールのアカウント作成は拒否する
    // (defense-in-depth。better-auth-google-gate スキルの必須項目)。
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = typeof user.email === "string" ? user.email.toLowerCase() : "";

            // メール/パスワード招待の内部プロビジョニング専用パス(詳細は CreateAuthOptions 参照)。
            // 対象メール完全一致の場合のみ、emailVerified必須チェックをスキップして
            // 指定ロール・emailVerified=trueで作成する。
            const invite = options.internalInviteProvisioning;
            if (invite && invite.email.toLowerCase() === email) {
              return { data: { ...user, role: invite.role, emailVerified: true } };
            }

            if (!user.emailVerified) {
              throw new APIError("FORBIDDEN", { message: "ACCESS_DENIED" });
            }

            // 初期管理者のブートストラップ: BOOTSTRAP_ADMIN_EMAILS に一致するメールで
            // 初めてサインインしたユーザーは、作成時点で role=admin にする。
            // 対象は既知のごく少数の業務担当者アドレスのみ(WORKSPACE_DOMAINS同様、環境変数で管理)。
            if (bootstrapAdminEmails.has(email)) {
              return { data: { ...user, role: "admin" } };
            }

            // ユーザー招待: 管理者が /admin/users で事前に「このメールにはこのロール」を
            // 予約していれば、初回サインイン時にそのロールを引き継ぐ(DBへ直接roleをUPDATEする
            // 運用を無くすため)。Googleでのサインイン自体はWORKSPACE_DOMAINSが引き続き制御する。
            const invited = await db
              .select({ id: userInvitation.id, role: userInvitation.role })
              .from(userInvitation)
              .where(
                and(
                  eq(userInvitation.email, email),
                  eq(userInvitation.authMethod, "google"),
                  eq(userInvitation.revoked, false),
                  isNull(userInvitation.acceptedAt),
                ),
              )
              .limit(1);
            const invitation = invited[0];
            if (invitation) {
              await db
                .update(userInvitation)
                .set({ acceptedAt: new Date() })
                .where(eq(userInvitation.id, invitation.id));
              return { data: { ...user, role: invitation.role } };
            }

            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // 管理者が凍結(banned)したユーザーは、既存Cookieが残っていても新規セッションを
            // 作れないようにする(要件: 「ログインできないようにする仕組み」)。
            const rows = await db
              .select({ banned: authSchema.user.banned, email: authSchema.user.email })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, session.userId))
              .limit(1);
            const row = rows[0];
            if (row?.banned) {
              throw new APIError("FORBIDDEN", { message: "ACCOUNT_DISABLED" });
            }

            // メール/パスワード招待(authMethod="password")の受諾確定。
            // このユーザー行はGoogleのuser.create.beforeフックを経由せず、招待作成時に
            // 直接INSERTされているため、「初回サインイン成功」の合図はここ(セッション発行)にしかない。
            // 本人がbetter-authのresetPassword APIで実際にパスワードを設定・照合できて初めて
            // ここへ到達するため、これを「本人確認が取れた」証跡として招待を受諾済みにする。
            if (row) {
              const email = row.email.toLowerCase();
              const invited = await db
                .select({ id: userInvitation.id })
                .from(userInvitation)
                .where(
                  and(
                    eq(userInvitation.email, email),
                    eq(userInvitation.authMethod, "password"),
                    eq(userInvitation.revoked, false),
                    isNull(userInvitation.acceptedAt),
                  ),
                )
                .limit(1);
              const invitation = invited[0];
              if (invitation) {
                await db
                  .update(userInvitation)
                  .set({ acceptedAt: new Date() })
                  .where(eq(userInvitation.id, invitation.id));
                await db
                  .update(authSchema.user)
                  .set({ emailVerified: true })
                  .where(eq(authSchema.user.id, session.userId));
              }
            }

            return { data: session };
          },
        },
      },
    },
    // ロール: 山本(input_staff) / 今西(admin) / 社長(executive)。権限マトリクスは
    // 呼び出し側 (Route Handler / Server Component) で解釈する。新規ユーザーは既定 input_staff とし、
    // 昇格は管理者が /admin/users 画面から行う(BOOTSTRAP_ADMIN_EMAILSに載る初期管理者のみ自動付与)。
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "input_staff",
          input: false,
        },
        banned: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

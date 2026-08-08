/**
 * ローカル開発用のメール/パスワードアカウントを作る開発専用スクリプト。
 *
 * なぜ必要か:
 *   このアプリは better-auth の emailAndPassword.disableSignUp で自己サインアップを禁じており、
 *   パスワードアカウントを作れるのは /api/admin/invitations (manage_users 権限が必要) だけ。
 *   まっさらなローカルDBには admin が1人もいないので、そのAPIを叩けない (鶏卵問題)。
 *   本番コードに開発用の抜け道を足すのは防御を薄くするので、代わりにDBへ直接行を挿す。
 *
 * password 列には平文ではなく better-auth と同じ形式のハッシュを入れる。
 * 自前で scrypt を実装せず better-auth/crypto の hashPassword を借りるのは、
 * 検証側 (verifyPassword) と少しでもパラメータがずれると「作れたのにログインできない」
 * という切り分けの難しい失敗になるため。
 *
 * 使い方:
 *   node scripts/seed-dev-user.mjs <email> <password> [role]
 *   role の既定は admin (招待画面や率マスタ設定まで触れるようにするため)
 *
 * 出力したSQLは wrangler d1 execute --local へ渡す。--remote には流さないこと。
 */
import { hashPassword } from "better-auth/crypto";

const [email, password, role = "admin"] = process.argv.slice(2);

if (!email || !password) {
  console.error("usage: node scripts/seed-dev-user.mjs <email> <password> [role]");
  process.exit(1);
}
if (password.length < 8) {
  // /api/admin/invitations と同じ下限。ここだけ緩いと「開発では通るのに招待経由では弾かれる」
  // パスワードが生まれ、動作確認の前提がずれる。
  console.error("password は8文字以上にしてください (招待APIと同じ下限)");
  process.exit(1);
}

const VALID_ROLES = ["admin", "executive", "manager", "input_staff"];
if (!VALID_ROLES.includes(role)) {
  console.error(`role は次のいずれか: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

const hash = await hashPassword(password);
const now = Date.now();
const userId = `dev-${Buffer.from(email).toString("hex").slice(0, 24)}`;
const accountId = `${userId}-credential`;
const name = email.split("@")[0] ?? email;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// 再実行しても壊れないよう upsert にする。パスワードを変えたいときに
// 「DELETE してから作り直す」手順を覚えなくて済む。
console.log(`
INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role, banned)
VALUES (${q(userId)}, ${q(name)}, ${q(email)}, 1, ${now}, ${now}, ${q(role)}, 0)
ON CONFLICT(email) DO UPDATE SET role = excluded.role, banned = 0, updated_at = ${now};

-- credential プロバイダの account_id は better-auth の慣習に合わせて user.id を入れる
-- (メールではない)。招待API経由で作られた行と形を揃えておかないと、
-- 「手で作ったアカウントだけ挙動が違う」という再現しにくい差が生まれる。
INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES (${q(accountId)}, ${q(userId)}, 'credential',
        (SELECT id FROM user WHERE email = ${q(email)}), ${q(hash)}, ${now}, ${now})
ON CONFLICT(id) DO UPDATE SET
  account_id = excluded.account_id, password = excluded.password, updated_at = ${now};
`);

import Link from "next/link";
import { hasPermission, type Permission, type Role } from "../../src/domain/rules/permissions";
import { PageHead } from "./PageHead";

const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  input_staff: "入力担当",
  executive: "経営",
};

const ROLES: readonly Role[] = ["admin", "input_staff", "executive"];

/**
 * その権限を持つロールの呼び名を並べる。
 * 文言に「管理者のみ」と直書きすると、権限マトリクスを変えたときにここだけ古い説明が残る。
 */
export function describeAllowedRoles(permission: Permission): string {
  return ROLES.filter((r) => hasPermission(r, permission))
    .map((r) => ROLE_LABELS[r])
    .join("・");
}

/**
 * 権限が足りない画面を開いたときの説明。
 *
 * これまでは黙ってホームへ戻していたため、押した本人には「リンクが壊れている」
 * としか見えず、誰に頼めばよいかも分からなかった。開けない理由と次の一手を出す。
 * 中身(給与などの個人データ)は一切描かないので、露出の条件は今までと変わらない。
 */
export function AccessDenied({
  screenName,
  permission,
}: {
  /** 開こうとした画面の名前(サイドバーに出ている呼び名と揃える) */
  screenName: string;
  permission: Permission;
}) {
  return (
    <div className="max-w-2xl">
      <PageHead kind="tool" title={screenName} />
      <div className="rounded-xl border border-line bg-white px-6 py-10 text-center">
        <p className="text-sm font-semibold text-ink">
          「{screenName}」は{describeAllowedRoles(permission)}のみが開けます。
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          必要な場合は管理者にご依頼ください。
        </p>
        <Link
          href="/"
          className="btn btn-primary pressable mt-4 inline-block"
        >
          ホームに戻る
        </Link>
      </div>
    </div>
  );
}

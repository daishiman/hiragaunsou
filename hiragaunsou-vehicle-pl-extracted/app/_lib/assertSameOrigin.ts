/**
 * 状態変更API(非GET)向けのCSRF防御。Better AuthのCookieはSameSite=Laxで大半のクロスサイト
 * fetch/XHRを弾くが、launch-securityスキルの不変条件「Accessやセッションcookieだけに頼らず、
 * 非GETはOriginヘッダーを検証する」に従い、自前APIルート側でも明示的に検証する。
 */
export function isSameOriginRequest(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  // 同一オリジンのブラウザfetchは常にOriginヘッダーを送る。無い場合はブラウザ外(CLI/CSRF)とみなし拒否する。
  if (!origin) return false;
  return origin === expectedOrigin;
}

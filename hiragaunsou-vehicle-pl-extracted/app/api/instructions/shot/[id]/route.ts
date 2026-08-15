import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { shotSecretOf } from "../../../../../src/usecase/improvements/instructionDeps";
import { verifyShotUrl } from "../../../../../src/domain/rules/instructionAccess";

/**
 * 指示文に載せた画面の写しを、期限つきで配る。
 *
 * 画像そのものを外のサービスへ置かない。置いた瞬間に、消す権限も期限も
 * こちらの手を離れる。代わりにこのアプリが自分で配り、期限で閉じる。
 *
 * 断る理由は返さない。「署名が違う」と「期限が切れた」を区別して伝えると、
 * 総当たりの手がかりになる。読めるか読めないかだけを返す。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = await getCloudflareContext({ async: true });
  const { id } = await params;
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp") ?? "");
  const sig = url.searchParams.get("sig") ?? "";

  const ok = await verifyShotUrl(id, exp, sig, shotSecretOf(env), new Date());
  if (!ok) return new Response("Not Found", { status: 404 });

  const repo = new D1ImprovementRepository(createDb(env.DB));
  const dataUrl = await repo.findShot(id);
  if (!dataUrl) return new Response("Not Found", { status: 404 });

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return new Response("Not Found", { status: 404 });
  const [, mime, base64] = match;

  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return new Response(bytes, {
    headers: {
      "content-type": mime ?? "image/png",
      // 期限つきのURLなので、途中の経路に残させない。
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="improvement-${id}.png"`,
    },
  });
}

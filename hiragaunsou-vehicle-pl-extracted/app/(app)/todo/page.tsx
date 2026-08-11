import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetTodoBoardUseCase } from "../../../src/usecase/steps/getTodoBoard";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { findScreen } from "../../_lib/screens";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { TodoBoard } from "./TodoBoard";

/** F2/F7 ToDoボード (S1/S5相当)。要確認カードを「修正/承認」の2択で捌く。 */
export default async function TodoPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    // 画面の名前は screens.ts が唯一の出どころ。ここで別名を書くと横のメニューと食い違う
    return <AccessDenied screenName={findScreen("/todo")?.label ?? "要確認の一覧（まとめて）"} permission="view" />;
  }

  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  /*
    対象月の既定は「まだ締めていない、取込のある最も新しい月」に揃える(app/_lib/workingYearMonth.ts)。
    以前は画面ごとに当月・前月とバラバラで、取込画面で5月分を取り込んでから移ると
    別の月の空っぽの画面が出て「取り込んだのに反映されていない」ように見えていた。
  */
  const yearMonth = ym || (await resolveWorkingYearMonth(db));

  const useCase = new GetTodoBoardUseCase(new D1ReviewFlagRepository(db));
  const todo = await useCase.execute(yearMonth);

  return (
    <div>
      <ScreenHeader
        screen="/todo"
        action={
          <YearMonthSelect basePath="/todo" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />
      <TodoBoard initialCards={todo.cards} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetTodoBoardUseCase } from "../../../src/usecase/steps/getTodoBoard";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { TodoBoard } from "./TodoBoard";

/** F2/F7 ToDoボード (S1/S5相当)。要確認カードを「修正/承認」の2択で捌く。 */
export default async function TodoPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "view")) redirect("/");

  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const useCase = new GetTodoBoardUseCase(new D1ReviewFlagRepository(createDb(env.DB)));
  const todo = await useCase.execute(yearMonth);

  return (
    <div className="max-w-3xl">
      <PageHead
        kind="ops"
        title="ToDoボード"
        lead="未入力・要確認の一覧"
        action={
          <YearMonthSelect basePath="/todo" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />
      <TodoBoard initialCards={todo.cards} />
    </div>
  );
}

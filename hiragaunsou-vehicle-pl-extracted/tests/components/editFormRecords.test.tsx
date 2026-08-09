/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EditFormActionBar,
  EditableRowCells,
  requestLeave,
  useEditableRecords,
  type EditChange,
  type EditSubmitResult,
  type EditableFieldDef,
} from "../../app/_components/editForm";

/**
 * 「一覧を直してまとめて保存する」共通の土台。
 *
 * 率マスタ・車両マスタ・運転者マスタ・手入力がこの1つを使うので、ここが壊れると
 * 4画面が同時に壊れる。逆に言えば、ここで固定しておけば4画面の作法がずれない。
 * 見たいのは「打った人が次に何を知るか」:
 *   ・直した欄が分かること (札と元の値)、未保存の件数が正しいこと
 *   ・保存するのは直した項目だけであること
 *   ・一部だけ保存できなかったとき、打った内容が消えないこと
 *   ・保存しないまま離れようとしたら止まること
 */
interface Row {
  code: string;
  name: string;
  lease: number | null;
}

const RECORDS: Row[] = [
  { code: "1001", name: "山田", lease: 1200 },
  { code: "1002", name: "田中", lease: null },
];

const FIELDS: EditableFieldDef<Row>[] = [
  { field: "name", label: "氏名", kind: "text", read: (r) => r.name },
  {
    field: "lease",
    label: "リース",
    kind: "yen",
    read: (r) => (r.lease === null ? null : String(r.lease)),
  },
];

function Harness({ submit }: { submit: (changes: EditChange<Row>[]) => Promise<EditSubmitResult> }) {
  const form = useEditableRecords<Row>({
    records: RECORDS,
    rowKey: (r) => r.code,
    fields: FIELDS,
    submit,
  });
  return (
    <div>
      <table>
        <tbody>
          {RECORDS.map((r) => (
            <tr key={r.code}>
              <td>{r.code}</td>
              <EditableRowCells
                record={r}
                rowKey={r.code}
                fields={FIELDS}
                draft={form.draftOf(r.code)}
                onChange={form.setField}
                fieldErrorOf={form.fieldErrorOf}
                rowLabel={r.name}
              />
            </tr>
          ))}
        </tbody>
      </table>
      <EditFormActionBar form={form} />
    </div>
  );
}

function renderForm(submit = vi.fn(async () => ({}) as EditSubmitResult)) {
  render(<Harness submit={submit} />);
  return submit;
}

/** 画面の下の帯に出ている「未保存◯件」の◯。帯が出ていなければ null */
function unsavedCount(): string | null {
  return document.querySelector("[data-unsaved-count]")?.getAttribute("data-unsaved-count") ?? null;
}

describe("まとめて保存する編集フォーム", () => {
  it("打ち替えた欄に「変更」の札と元の値を出し、未保存の件数を出す", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/山田のリース/), "1500");

    expect(screen.getByText("変更")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(unsavedCount()).toBe("1");
  });

  it("打ち替えても元と同じ値なら未保存に数えない", async () => {
    const user = userEvent.setup();
    renderForm();

    // 「1,200」と「1200」は同じ値。書き方の違いで「直した」ことにしない
    await user.type(screen.getByLabelText(/山田のリース/), "1,200");

    expect(unsavedCount()).toBeNull();
    expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  });

  it("保存するのは直した項目だけにする", async () => {
    const user = userEvent.setup();
    const submit = renderForm();

    await user.type(screen.getByLabelText(/田中の氏名/), "郎");
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(submit).toHaveBeenCalledTimes(1);
    const changes = submit.mock.calls[0]![0] as unknown as EditChange<Row>[];
    expect(changes).toHaveLength(1);
    expect(changes[0]!.rowKey).toBe("1002");
    expect(changes[0]!.def.field).toBe("name");
    expect(changes[0]!.after).toBe("田中郎");
  });

  it("数字として読めない値があるうちは保存させない", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/山田のリース/), "あとで");

    expect(
      screen.getByText("1件の欄が数字として読めません。直してから保存してください"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  });

  it("一部だけ保存できなかったとき、その欄の内容を残して理由を出す", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(
      async (): Promise<EditSubmitResult> => ({
        failures: [{ rowKey: "1001", field: "lease", message: "この内容では保存できませんでした" }],
      }),
    );
    render(<Harness submit={submit} />);

    await user.type(screen.getByLabelText(/山田のリース/), "1500");
    await user.type(screen.getByLabelText(/田中の氏名/), "郎");
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(
      await screen.findByText("1件を保存しました。1件は保存できていません(赤い欄をご確認ください)"),
    ).toBeInTheDocument();
    expect(screen.getByText("この内容では保存できませんでした")).toBeInTheDocument();
    // 保存できなかった欄は打った内容のまま残す (画面を開き直さないと直せない状態にしない)
    expect(screen.getByLabelText(/山田のリース/)).toHaveValue("1500");
    // 保存できた欄は下書きから外れ、未保存は1件だけになる
    expect(unsavedCount()).toBe("1");
  });

  it("変更の取り消しは1回だけ確認してから元に戻す", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/山田のリース/), "1500");
    await user.click(screen.getByRole("button", { name: "変更を取り消す" }));

    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "変更を取り消す" }));

    // 取り消したあとは「いまの値」に戻る (欄が空になるのではなく、保存されている値が薄く入る)
    expect(screen.getByLabelText(/山田のリース/)).toHaveValue("1200");
    expect(screen.queryByText("変更")).not.toBeInTheDocument();
    expect(unsavedCount()).toBeNull();
  });

  it("保存しないまま離れようとしたら止めて、留まれば移動しない", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/山田のリース/), "1500");

    const move = vi.fn();
    let allowed = true;
    act(() => {
      allowed = requestLeave(move);
    });
    expect(allowed).toBe(false);
    expect(move).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "この画面に留まる" }));
    expect(move).not.toHaveBeenCalled();
  });

  it("直していないときは何も聞かずに移動できる", async () => {
    renderForm();
    const move = vi.fn();
    let allowed = false;
    act(() => {
      allowed = requestLeave(move);
    });
    expect(allowed).toBe(true);
    expect(move).toHaveBeenCalledTimes(1);
  });
});

/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EditableField,
  EditableRowCells,
  SelectEntryField,
} from "../../app/_components/editForm/EditableField";
import type { EditableFieldDef } from "../../app/_components/editForm/fieldDefs";

/**
 * 「まとめて保存する」画面の欄1つぶんの描画。
 *
 * 率マスタ・車両マスタ・運転者マスタ・手入力が同じこの部品を使う。見たいのは、
 * 種類 (文字・金額・選択・数) が違っても**同じ作法になる**こと:
 *   ・直していない欄は、いまの値が読める
 *   ・打ち替えると「変更」の札が出て、元の値が併記される
 *   ・元に戻す手段がある
 *   ・保存できなかった理由が、その欄の下に出る
 *
 * 欄ごとに作法がずれると、直したつもりが保存されていないのか、直っていないのかが
 * 読めなくなる。とくに選択の欄は色が変わらない実装になりやすい。
 */
interface Row {
  code: string;
  name: string;
  lease: number | null;
  depot: string | null;
  towedBy: string | null;
}

const RECORD: Row = { code: "24", name: "山田", lease: 1200, depot: null, towedBy: "301" };

const TEXT: EditableFieldDef<Row> = {
  field: "name",
  label: "氏名",
  kind: "text",
  read: (r) => r.name,
};
const YEN: EditableFieldDef<Row> = {
  field: "lease",
  label: "リース料",
  kind: "yen",
  read: (r) => (r.lease === null ? null : String(r.lease)),
};
const SELECT: EditableFieldDef<Row> = {
  field: "towedBy",
  label: "けん引するトラクタ",
  kind: "select",
  read: (r) => r.towedBy,
  options: () => [
    { value: "", label: "なし" },
    { value: "301", label: "301" },
    { value: "302", label: "302" },
  ],
};

describe("EditableField", () => {
  it("文字の欄は、いまの値を読める形で出す", () => {
    render(<EditableField def={TEXT} record={RECORD} draft={undefined} onChange={vi.fn()} />);
    // 触っていない欄は「いまの値です」と読み上げられる (目で見ていない人にも届かせる)
    expect(screen.getByLabelText("氏名(いまの値です)")).toBeInTheDocument();
  });

  it("金額の欄は、いまの値を添えて出す", () => {
    render(<EditableField def={YEN} record={RECORD} draft={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText("リース料(いまの値です)")).toBeInTheDocument();
  });

  it("単位があれば読み上げ名に含める(何の数字か分からない欄を作らない)", () => {
    const withUnit: EditableFieldDef<Row> = { ...YEN, unit: "円" };
    render(<EditableField def={withUnit} record={RECORD} draft={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText("リース料(円)(いまの値です)")).toBeInTheDocument();
  });

  it("行の名前を渡せば、それを読み上げ名にする(表の中でどの行か分かる)", () => {
    render(
      <EditableField
        def={TEXT}
        record={RECORD}
        draft={undefined}
        onChange={vi.fn()}
        ariaLabel="車番24の氏名"
      />,
    );
    expect(screen.getByLabelText("車番24の氏名(いまの値です)")).toBeInTheDocument();
  });

  it("保存できなかった理由は、その欄の下に出す(どの欄を直せばよいか分かる)", () => {
    render(
      <EditableField
        def={YEN}
        record={RECORD}
        draft="いくらか"
        onChange={vi.fn()}
        error="数字で入れてください"
      />,
    );
    expect(screen.getByText("数字で入れてください")).toBeInTheDocument();
  });

  it("金額の欄を空にすると「いまの値に戻す」と同じ意味になる", async () => {
    /*
      金額欄を空のまま保存したい場面は業務上なく、0にしたいなら0と打てる。
      空を「消す」と解釈すると、打ち間違いで金額が消える。
    */
    const onChange = vi.fn();
    render(<EditableField def={YEN} record={RECORD} draft="99" onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText(/^リース料/));
    expect(onChange).toHaveBeenLastCalledWith("lease", null);
  });

  it("触れない欄は入力させない", () => {
    render(
      <EditableField def={TEXT} record={RECORD} draft={undefined} onChange={vi.fn()} disabled />,
    );
    expect(screen.getByLabelText(/^氏名/)).toBeDisabled();
  });
});

describe("SelectEntryField (選択の欄も同じ作法にする)", () => {
  const options = [
    { value: "", label: "なし" },
    { value: "301", label: "301" },
    { value: "302", label: "302" },
  ];

  it("直していないときは、いまの値が選ばれている", () => {
    render(
      <SelectEntryField
        draft={null}
        onChange={vi.fn()}
        currentValue="301"
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    expect(screen.getByLabelText("けん引するトラクタ")).toHaveValue("301");
    expect(screen.queryByText("変更")).toBeNull();
  });

  it("いまの値が空でも壊れない", () => {
    render(
      <SelectEntryField
        draft={null}
        onChange={vi.fn()}
        currentValue={null}
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    expect(screen.getByLabelText("けん引するトラクタ")).toHaveValue("");
  });

  it("選び替えると札が出て、元の値が読み上げ名にも入る", () => {
    render(
      <SelectEntryField
        draft="302"
        onChange={vi.fn()}
        currentValue="301"
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    expect(screen.getByText("変更")).toBeInTheDocument();
    expect(screen.getByLabelText("けん引するトラクタ(変更しました。元は301)")).toHaveValue("302");
  });

  it("元が未設定でも、選択肢の呼び名で元を示す(空欄のままでは何が元か分からない)", () => {
    render(
      <SelectEntryField
        draft="301"
        onChange={vi.fn()}
        currentValue={null}
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    expect(
      screen.getByLabelText("けん引するトラクタ(変更しました。元はなし)"),
    ).toBeInTheDocument();
  });

  it("いまの値と同じものを選び直したら、直していない扱いに戻す", async () => {
    const onChange = vi.fn();
    render(
      <SelectEntryField
        draft="302"
        onChange={onChange}
        currentValue="301"
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/けん引するトラクタ/), "301");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("「いまの値に戻す」で1欄だけ取り消せる", async () => {
    const onChange = vi.fn();
    render(
      <SelectEntryField
        draft="302"
        onChange={onChange}
        currentValue="301"
        options={options}
        ariaLabel="けん引するトラクタ"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "いまの値に戻す" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("触れないときは、戻す手段も出さない(押せないボタンを見せない)", () => {
    render(
      <SelectEntryField
        draft="302"
        onChange={vi.fn()}
        currentValue="301"
        options={options}
        ariaLabel="けん引するトラクタ"
        disabled
      />,
    );
    expect(screen.getByLabelText(/けん引するトラクタ/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "いまの値に戻す" })).toBeNull();
  });
});

describe("EditableRowCells (表の1行ぶん)", () => {
  function renderRow(props: Partial<Parameters<typeof EditableRowCells<Row>>[0]> = {}) {
    return render(
      <table>
        <tbody>
          <tr>
            <EditableRowCells<Row>
              record={RECORD}
              rowKey="24"
              fields={[TEXT, YEN, SELECT]}
              draft={undefined}
              onChange={vi.fn()}
              fieldErrorOf={() => undefined}
              rowLabel="車番24"
              {...props}
            />
          </tr>
        </tbody>
      </table>,
    );
  }

  it("行の名前を欄ごとの読み上げ名に前置する", () => {
    renderRow();
    expect(screen.getByLabelText("車番24の氏名(いまの値です)")).toBeInTheDocument();
    expect(screen.getByLabelText("車番24のリース料(いまの値です)")).toBeInTheDocument();
  });

  it("直せない欄は、入力欄ではなく理由を出す(押せない欄を見せない)", () => {
    const disabledField: EditableFieldDef<Row> = {
      ...YEN,
      enabled: () => false,
      disabledText: "トレーラには付かない",
    };
    renderRow({ fields: [disabledField] });
    expect(screen.getByText("トレーラには付かない")).toBeInTheDocument();
    expect(screen.queryByLabelText(/車番24のリース料/)).toBeNull();
  });

  it("理由の指定が無ければ、記号だけ置く", () => {
    renderRow({ fields: [{ ...YEN, enabled: () => false }] });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("欄ごとの理由をその欄に配る", () => {
    renderRow({
      fieldErrorOf: (rowKey, field) =>
        rowKey === "24" && field === "lease" ? "数字で入れてください" : undefined,
    });
    expect(screen.getByText("数字で入れてください")).toBeInTheDocument();
  });

  it("打った値は、その行のその欄にだけ戻す", () => {
    renderRow({ draft: { name: "山田 太郎" } });
    expect(screen.getByLabelText(/車番24の氏名/)).toHaveValue("山田 太郎");
  });
});

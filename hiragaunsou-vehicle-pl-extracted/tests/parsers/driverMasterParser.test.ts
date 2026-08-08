import { describe, expect, it } from "vitest";
import { parseDriverMasterCsv } from "../../src/infrastructure/parsers/driverMasterParser";

const HEADER = "社員No,氏名,車番";

describe("parseDriverMasterCsv", () => {
  it("社員No・氏名・車番を取り込む", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,山田太郎,24\n1002,鈴木一郎,300`);

    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" },
      { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
    ]);
  });

  /**
   * 給与集計表の社員Noも運行実績の車番も先頭ゼロ付きで出力されることがある。
   * ここで同じ正規化をかけておかないと、突合が静かに外れて人件費が0のまま並ぶ。
   */
  it("社員Noと車番の先頭ゼロを落として、給与・運行実績と同じキーに揃える", () => {
    const { valid } = parseDriverMasterCsv(`${HEADER}\n0001,山田太郎,0024`);

    expect(valid[0]).toEqual({ employeeCode: "1", driverName: "山田太郎", vehicleNo: "24" });
  });

  it("給与集計表と同じ全角スペース入りの見出し「氏　名」も受ける", () => {
    const { valid } = parseDriverMasterCsv("社員No,氏　名,車番\n1001,山田太郎,24");

    expect(valid[0]?.driverName).toBe("山田太郎");
  });

  it("車番が空の行は未割当として取り込む(内勤・退職者を弾かない)", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,山田太郎,`);

    expect(errors).toEqual([]);
    expect(valid[0]?.vehicleNo).toBeNull();
  });

  /**
   * 社員Noは主キー。後勝ちで黙って上書きすると、どちらの車番が採用されたか
   * 誰にも分からないまま、その人の給与が別の車両に乗る。
   */
  it("社員Noの重複は後勝ちにせず、行番号を添えて弾く", () => {
    const { valid, errors } = parseDriverMasterCsv(
      `${HEADER}\n1001,山田太郎,24\n1001,山田太郎,300`,
    );

    expect(valid).toHaveLength(1);
    expect(valid[0]?.vehicleNo).toBe("24");
    expect(errors[0]).toEqual({
      rowNumber: 3,
      employeeCode: "1001",
      reason: "社員コードが2行目と重複しています",
    });
  });

  it("氏名が空の行はエラーにする", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,,24`);

    expect(valid).toEqual([]);
    expect(errors[0]?.reason).toBe("氏名が空です");
  });

  it("合計行・空行は読み飛ばす", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n,合計,\n1001,山田太郎,24`);

    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });

  it("必須列が欠けたCSVは、何が足りないか分かる形で失敗する", () => {
    expect(() => parseDriverMasterCsv("社員No,氏名\n1001,山田太郎")).toThrow(/運転者マスタ/);
  });
});

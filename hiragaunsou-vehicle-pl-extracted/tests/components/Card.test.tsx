/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, Prose } from "../../app/_components/Card";

/**
 * 全画面の「面」と「説明文の器」。
 *
 * これまでは各画面が `rounded-xl border border-line bg-white p-5` を直接書いており、
 * 角丸や余白が画面ごとに1〜2pxずれるだけでなく、長い日本語がカードの枠から
 * はみ出る不具合を画面ごとに1枚ずつ直すことになっていた。
 * 器をここ1つにした以上、この部品が崩れると全画面が同時に崩れる。
 */
describe("Card", () => {
  it("見出しが無くても面として成立する(数字だけのタイルなど)", () => {
    const { container } = render(<Card>中身</Card>);
    expect(screen.getByText("中身")).toBeInTheDocument();
    // 見出しが無いときに空の見出し行を作らない
    expect(container.querySelector("h2")).toBeNull();
  });

  it("見出しを渡すと h2 で出す(読み上げの見出しとして拾える)", () => {
    render(<Card title="アカウント情報">中身</Card>);
    expect(screen.getByRole("heading", { level: 2, name: "アカウント情報" })).toBeInTheDocument();
  });

  it("見出しの右に補助操作を置ける", () => {
    render(
      <Card title="登録済みのAPIキー" action={<button type="button">追加する</button>}>
        中身
      </Card>,
    );
    expect(screen.getByRole("button", { name: "追加する" })).toBeInTheDocument();
  });

  it("見出しが無くても操作だけ置ける", () => {
    render(<Card action={<button type="button">書き出す</button>}>中身</Card>);
    expect(screen.getByRole("button", { name: "書き出す" })).toBeInTheDocument();
  });

  /*
    はみ出し対策は globals.css の .card が持つ (min-width と折り返し)。
    ここで見るのは「その .card が必ず付くこと」だけ。
    class を書き換えると全画面の折り返しが同時に壊れる。
  */
  it("面の見た目は .card に寄せる(画面側で書き起こさせない)", () => {
    const { container } = render(<Card>中身</Card>);
    const section = container.querySelector("section");
    expect(section?.className).toContain("card");
  });

  it("既定は通常の内側余白", () => {
    const { container } = render(<Card>中身</Card>);
    expect(container.querySelector("section")?.className).toContain("p-5");
  });

  /** 行を敷き詰める一覧では、外枠の余白を外して行の余白に任せる */
  it("tight を渡すと外枠の余白を外し、中身に行用の余白を付ける", () => {
    const { container } = render(
      <Card title="車両マスタ" padding="tight">
        行
      </Card>,
    );
    const section = container.querySelector("section");
    expect(section?.className).toContain("p-0");
    expect(section?.className).not.toContain("p-5");
    // 見出しは行と本文の区切り線を持つ
    expect(container.querySelector(".border-b")).not.toBeNull();
  });

  it("画面ごとの調整は className で足せる", () => {
    const { container } = render(<Card className="mt-4">中身</Card>);
    expect(container.querySelector("section")?.className).toContain("mt-4");
  });
});

describe("Prose", () => {
  it("説明文は .prose-note に入れる(折り返しの指定を持つのはCSS1箇所だけ)", () => {
    const { container } = render(<Prose>どのファイルを選べばよいですか?</Prose>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("prose-note");
    expect(screen.getByText("どのファイルを選べばよいですか?")).toBeInTheDocument();
  });

  it("既定は補足の灰文字", () => {
    const { container } = render(<Prose>補足</Prose>);
    expect(container.querySelector("div")?.className).toContain("text-ink-muted");
  });

  it("本文と同じ濃さにもできる", () => {
    const { container } = render(<Prose tone="normal">本文</Prose>);
    const cls = container.querySelector("div")?.className ?? "";
    expect(cls).toContain("text-ink");
    expect(cls).not.toContain("text-ink-muted");
  });

  it("画面ごとの調整は className で足せる", () => {
    const { container } = render(<Prose className="mt-2">補足</Prose>);
    expect(container.querySelector("div")?.className).toContain("mt-2");
  });
});

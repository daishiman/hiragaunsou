/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackWidget } from "../../app/_components/FeedbackWidget";

/**
 * 全画面の右下から送る「改善要望」。
 *
 * ここで固定するのは、意見が消えずに届くための約束。
 *  1. 押した時点で画面を撮り、書き込める状態まで自動で進む
 *  2. 撮れなくても、画像を外しても、文章だけで送れる
 *  3. 本文が空なら押す前に理由を出す
 *  4. 送れなかったとき入力内容を消さない・開き直しても消さない
 *  5. 黒塗りのときは色を選ばせない
 *
 * jsdom には canvas の描画も画像の読み込みも無いので、その2つだけを差し替える。
 * 判定しているのは差し替えた側ではなく、部品が出す文言と送信内容。
 */

const domToCanvasMock = vi.hoisted(() => vi.fn());
vi.mock("modern-screenshot", () => ({ domToCanvas: domToCanvasMock }));
vi.mock("next/navigation", () => ({ usePathname: () => "/grid" }));

const SHOT = "data:image/jpeg;base64,AAAA";

function stubCanvas() {
  const ctx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textBaseline: "",
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => SHOT) as never;
  return ctx;
}

class FakeImage {
  naturalWidth = 800;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = "";
  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.#src;
  }
  decode() {
    return Promise.resolve();
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubCanvas();
  vi.stubGlobal("Image", FakeImage);
  domToCanvasMock.mockReset();
  domToCanvasMock.mockResolvedValue({ toDataURL: () => SHOT });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "improve_1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = vi.fn(
    () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 右下のボタンを押して、写しが出るところまで進める。 */
async function openAndShoot(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "改善要望" }));
  await waitFor(() => expect(screen.getByLabelText(/画面の写し/)).toBeInTheDocument());
}

describe("FeedbackWidget", () => {
  it("押した時点で撮り、書き込める状態まで自動で進む", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    expect(domToCanvasMock).toHaveBeenCalledTimes(1);
    // どの画面についての要望かを、URLから引いて出す (打たせない)
    expect(screen.getByText("月次収支表（1か月・車両ごと）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撮り直す" })).toBeInTheDocument();
  });

  it("この仕組み自体は写しの対象から外す", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    const options = domToCanvasMock.mock.calls[0]?.[1] as { filter: (n: Node) => boolean };
    const self = document.createElement("div");
    self.className = "feedback-root";
    expect(options.filter(self)).toBe(false);
    expect(options.filter(document.createElement("main"))).toBe(true);
  });

  it("撮れなかったときは、貼り付けとファイル選択へ逃がす", async () => {
    domToCanvasMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByRole("button", { name: "改善要望" }));

    await waitFor(() =>
      expect(
        screen.getByText("うまく撮れませんでした。画像を貼り付けるか、ファイルを選んでください。"),
      ).toBeInTheDocument(),
    );
    // 撮れなくても本文の欄は使える (送る手段を失わせない)
    expect(screen.getByLabelText("改善したいこと")).toBeEnabled();
  });

  it("本文が空なら、送る前に理由を出して送信しない", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(screen.getByRole("alert")).toHaveTextContent("改善したいことを入力してください。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("本文と画像を、開いていた画面のパスと一緒に送る", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.type(screen.getByLabelText("改善したいこと"), "合計が右端で切れています");
    await user.click(screen.getByRole("button", { name: "送る" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sent.path).toBe("/grid");
    expect(sent.body).toBe("合計が右端で切れています");
    expect(sent.shot).toBe(SHOT);
    expect(String(sent.submissionKey)).toHaveLength(36);
    expect(await screen.findByText("送りました。ありがとうございます。")).toBeInTheDocument();
  });

  it("断られたら、サーバーの言い分をそのまま出して内容を残す", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "送信が続いています。" }), { status: 429 }),
    );
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.type(screen.getByLabelText("改善したいこと"), "重い");
    await user.click(screen.getByRole("button", { name: "送る" }));

    expect(await screen.findByText("送信が続いています。")).toBeInTheDocument();
    expect(screen.getByLabelText("改善したいこと")).toHaveValue("重い");
  });

  it("通信できなくても入力内容を消さない", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.type(screen.getByLabelText("改善したいこと"), "遅い");
    await user.click(screen.getByRole("button", { name: "送る" }));

    expect(
      await screen.findByText("通信できませんでした。入力内容はこの窓に残っています。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("改善したいこと")).toHaveValue("遅い");
  });

  it("送れなかった後に押し直しても、同じ鍵で送る (2件にしない)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.type(screen.getByLabelText("改善したいこと"), "遅い");
    await user.click(screen.getByRole("button", { name: "送る" }));
    await screen.findByText("通信できませんでした。入力内容はこの窓に残っています。");
    await user.click(screen.getByRole("button", { name: "送る" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { submissionKey: string };
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { submissionKey: string };
    expect(second.submissionKey).toBe(first.submissionKey);
  });

  it("画像を外して文章だけで送れる", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.click(screen.getByRole("button", { name: "画像を外す（文章だけで送る）" }));
    expect(screen.getByText("画像を外しました。文章だけで送れます。")).toBeInTheDocument();
    expect(screen.queryByLabelText(/画面の写し/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("改善したいこと"), "文字が小さい");
    await user.click(screen.getByRole("button", { name: "送る" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { shot: string | null };
    expect(sent.shot).toBeNull();
  });

  it("書きかけがあるときは、開き直しても消さない", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.type(screen.getByLabelText("改善したいこと"), "書きかけ");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await user.click(screen.getByRole("button", { name: "改善要望" }));

    expect(screen.getByText("閉じる前の未送信内容を復元しました。")).toBeInTheDocument();
    expect(screen.getByLabelText("改善したいこと")).toHaveValue("書きかけ");
    // 撮り直しは走らせない (書き込んだ印を消さない)
    expect(domToCanvasMock).toHaveBeenCalledTimes(1);
  });

  it("黒塗りのときは色を選ばせない", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    expect(screen.getByRole("group", { name: "印の色" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "黒塗り" }));
    expect(screen.queryByRole("group", { name: "印の色" })).not.toBeInTheDocument();
  });

  it("文字の道具は、入れる文字を打つ前に押すと理由を出す", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.click(screen.getByRole("button", { name: "文字" }));
    const canvas = screen.getByLabelText(/画面の写し/);
    await user.pointer({ keys: "[MouseLeft]", target: canvas });

    expect(screen.getByText("先に、上の欄へ入れる文字を打ってください。")).toBeInTheDocument();
  });

  it("押せる札は指でも押せる大きさの決まり (feedback-chip) に揃える", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    for (const name of ["四角", "矢印", "手書き", "文字", "黒塗り"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("feedback-chip");
    }
    expect(screen.getByRole("button", { name: "赤で書く" })).toHaveClass("feedback-chip");
  });

  it("印が1つも無いうちは「元に戻す」を押させない", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  describe("写しへの書き込み", () => {
    /** 押して・引いて・離す。道具ごとに1本ずつ引ければ、印は1つ増える。 */
    function drag(canvas: HTMLElement) {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 240 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }

    it.each(["四角", "矢印", "手書き", "黒塗り"])("%s で引くと、元に戻せる印が1つ増える", async (name) => {
      const user = userEvent.setup();
      render(<FeedbackWidget />);
      await openAndShoot(user);

      await user.click(screen.getByRole("button", { name }));
      drag(screen.getByLabelText(/画面の写し/));

      const undoButton = screen.getByRole("button", { name: "元に戻す" });
      await waitFor(() => expect(undoButton).toBeEnabled());
      await user.click(undoButton);
      expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    });

    it("文字は、打った内容を押した場所に置く", async () => {
      const user = userEvent.setup();
      render(<FeedbackWidget />);
      await openAndShoot(user);

      await user.click(screen.getByRole("button", { name: "文字" }));
      await user.type(screen.getByPlaceholderText("入れる文字を打ってから、画像を押します"), "ここ");
      fireEvent.pointerDown(screen.getByLabelText(/画面の写し/), {
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled());
      expect(screen.queryByText("先に、上の欄へ入れる文字を打ってください。")).not.toBeInTheDocument();
    });

    it("色を選び直しても、写しは消えない", async () => {
      const user = userEvent.setup();
      render(<FeedbackWidget />);
      await openAndShoot(user);

      await user.click(screen.getByRole("button", { name: "青で書く" }));
      expect(screen.getByRole("button", { name: "青で書く" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByLabelText(/画面の写し/)).toBeInTheDocument();
    });
  });

  it("撮り直すと、書き込んだ印を捨てて撮り直す", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    await user.click(screen.getByRole("button", { name: "四角" }));
    fireEvent.pointerDown(screen.getByLabelText(/画面の写し/), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByLabelText(/画面の写し/), { pointerId: 1 });
    await waitFor(() => expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "撮り直す" }));

    await waitFor(() => expect(domToCanvasMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled());
  });

  it("画像を貼り付けると、撮り直しの代わりにその画像を使う", async () => {
    domToCanvasMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await user.click(screen.getByRole("button", { name: "改善要望" }));
    await screen.findByText("うまく撮れませんでした。画像を貼り付けるか、ファイルを選んでください。");

    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("dialog", { hidden: true }), {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
    });

    await waitFor(() => expect(screen.getByLabelText(/画面の写し/)).toBeInTheDocument());
  });

  it("画像以外を貼り付けても、何も起きない", async () => {
    const user = userEvent.setup();
    render(<FeedbackWidget />);
    await openAndShoot(user);

    fireEvent.paste(screen.getByRole("dialog", { hidden: true }), {
      clipboardData: { items: [{ type: "text/plain", getAsFile: () => null }] },
    });

    expect(screen.getByLabelText(/画面の写し/)).toBeInTheDocument();
    expect(screen.queryByText("画像を読み込めませんでした。別の画像をお試しください。")).toBeNull();
  });

  it("ファイルを選んでも、その画像を使える", async () => {
    const user = userEvent.setup();
    const { container } = render(<FeedbackWidget />);
    await openAndShoot(user);
    await user.click(screen.getByRole("button", { name: "画像を外す（文章だけで送る）" }));

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/画面の写し/)).toBeInTheDocument());
  });
});

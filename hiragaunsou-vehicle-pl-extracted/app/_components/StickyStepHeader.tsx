import type { ReactNode } from "react";
import { StepRail, type StepRailItem } from "./StepRail";

/**
 * 工程タブを画面の上に貼り付けておく帯 (全画面共通)。
 *
 * 手入力も取込もマスタ登録も「いくつかの工程を順に進める」作業で、
 * 表を下までスクロールすると自分がどの工程にいるのか分からなくなる。
 * 工程タブは作業中ずっと見えている必要があるので、貼り付けを画面ごとに書かず
 * ここ1箇所で決める。高さと貼り付け位置は globals.css の
 * --app-header-h / --screen-step-header-h だけで決まる。
 *
 * アプリ共通ヘッダー (z-30) の下に潜り込ませるため z-20 に置く。
 * main の左右余白 (px-4 / lg:px-8) を打ち消して、帯だけ画面幅いっぱいに伸ばす。
 */
export function StickyStepHeader({
  steps,
  currentIndex,
  onSelect,
  trailing,
}: {
  steps: readonly StepRailItem[];
  currentIndex: number;
  onSelect?: (index: number) => void;
  /** 右端に出す補足 (年月など) */
  trailing?: ReactNode;
}) {
  return (
    <div
      data-sticky="step"
      data-sticky-top="header"
      className="screen-step-header sticky top-[var(--app-header-h)] z-20 -mx-4 box-border flex h-[var(--screen-step-header-h)] items-center border-b border-line bg-brand-mist/95 px-4 py-1 backdrop-blur lg:-mx-8 lg:px-8"
    >
      <StepRail
        steps={steps}
        currentIndex={currentIndex}
        onSelect={onSelect}
        trailing={trailing}
      />
    </div>
  );
}

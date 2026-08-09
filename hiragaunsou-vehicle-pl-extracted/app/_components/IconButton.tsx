"use client";

import { Icon, type IconName } from "./Icon";
import { useHoverTooltip, type TooltipPlacement } from "./useHoverTooltip";

export interface IconButtonProps {
  name: IconName;
  /**
   * 何が起きるかを動詞で書く。これがボタンの名前(aria-label)であり、
   * ホバー/フォーカスで出るツールチップの文言でもある。
   * 「メニュー」のような名詞ではなく「メニューを隠す」と書く。
   */
  label: string;
  onClick: () => void;
  placement?: TooltipPlacement;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  className?: string;
}

/**
 * アイコンだけのボタン。
 *
 * アイコンだけにしてよいのは「意味が一意に決まる操作」だけ (docs/design-system.md §11-10)。
 * その代わり、名前は必ず label で与える:
 *   - aria-label  … 読み上げとテストがこの名前でボタンを特定できる
 *   - ツールチップ … マウスでもキーボード(フォーカス)でも同じ文が読める
 * 見た目から文字を外しても、意味に辿り着く手段は残す、という約束をここ1箇所で守る。
 */
export function IconButton({
  name,
  label,
  onClick,
  placement = "bottom",
  className,
  ...aria
}: IconButtonProps) {
  const { triggerRef, tooltipId, handlers, tooltip } = useHoverTooltip<HTMLButtonElement>(
    label,
    placement,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={aria["aria-expanded"]}
        aria-controls={aria["aria-controls"]}
        {...handlers}
        className={[
          "pressable inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          "text-ink-muted transition-colors hover:bg-subtle hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          className ?? "",
        ].join(" ")}
      >
        <Icon name={name} size={18} />
      </button>
      {tooltip}
    </>
  );
}

import type { AiProvider } from "../repositories/AiProviderCredentialRepository";

/**
 * AI連携APIキー管理画面のモデル選択肢。
 *
 * モデル名だけでは一般ユーザーがどれを選ぶべきか分からないため、プロバイダごとに
 * 上/中/下3ランクへ丸め、直感的な日本語ラベルと選び方の補足を添える。
 * Domain層: フレームワーク非依存の静的カタログ (D1には保存しない)。
 */
export type ModelRank = "top" | "standard" | "light";

export interface ModelOption {
  /** APIに渡すモデルID */
  id: string;
  rank: ModelRank;
  /** 画面に出す短いラベル (ランクが一目で分かる言い方にする) */
  label: string;
  /** 選ぶ基準の補足 (精度・速度・コストのどれを優先するか) */
  description: string;
}

export const MODEL_RANK_ORDER: readonly ModelRank[] = ["top", "standard", "light"];

export const MODEL_CATALOG: Record<AiProvider, ModelOption[]> = {
  anthropic: [
    {
      id: "claude-opus-5",
      rank: "top",
      label: "最高精度 (Opus 5)",
      description: "複雑な要因分析を最も精度高く行う。コストは3ランクの中で最も高い。",
    },
    {
      id: "claude-sonnet-5",
      rank: "standard",
      label: "標準 (Sonnet 5)",
      description: "精度とコストのバランスが良く、迷ったらこれを選ぶ。",
    },
    {
      id: "claude-haiku-4-5-20251001",
      rank: "light",
      label: "高速・低コスト (Haiku 4.5)",
      description: "簡易な分析を素早く安く行う。要因分析レポートの既定モデル。",
    },
  ],
  // 2026年8月5日時点のWeb検索結果を根拠に選定。各社ともモデル改廃が頻繁なため、
  // 呼び出しが失敗するようになった場合はまずプロバイダの公式モデル一覧を確認すること。
  openai: [
    {
      id: "gpt-5.6-sol",
      rank: "top",
      label: "最高精度 (GPT-5.6 Sol)",
      description: "複雑な要因分析を最も精度高く行う。コストは3ランクの中で最も高い。",
    },
    {
      id: "gpt-5.6-terra",
      rank: "standard",
      label: "標準 (GPT-5.6 Terra)",
      description: "精度とコストのバランスが良く、迷ったらこれを選ぶ。",
    },
    {
      id: "gpt-5.6-luna",
      rank: "light",
      label: "高速・低コスト (GPT-5.6 Luna)",
      description: "簡易な分析を素早く安く行う。",
    },
  ],
  google: [
    {
      id: "gemini-3.1-pro",
      rank: "top",
      label: "最高精度 (Gemini 3.1 Pro)",
      description: "複雑な要因分析を最も精度高く行う。コストは3ランクの中で最も高い。",
    },
    {
      id: "gemini-3.5-flash",
      rank: "standard",
      label: "標準 (Gemini 3.5 Flash)",
      description: "精度とコストのバランスが良く、迷ったらこれを選ぶ。",
    },
    {
      id: "gemini-3.1-flash-lite",
      rank: "light",
      label: "高速・低コスト (Gemini 3.1 Flash Lite)",
      description: "簡易な分析を素早く安く行う。",
    },
  ],
  xai: [
    {
      id: "grok-4.5",
      rank: "top",
      label: "最高精度 (Grok 4.5)",
      description: "複雑な要因分析を最も精度高く行う。コストは3ランクの中で最も高い(EUリージョンでは利用できない場合がある)。",
    },
    {
      id: "grok-4.3",
      rank: "standard",
      label: "標準 (Grok 4.3)",
      description: "精度とコストのバランスが良く、迷ったらこれを選ぶ。",
    },
    {
      id: "grok-4-1-fast-non-reasoning",
      rank: "light",
      label: "高速・低コスト (Grok 4.1 Fast)",
      description: "簡易な分析を素早く安く行う。",
    },
  ],
};

export function findModelOption(provider: AiProvider, modelId: string): ModelOption | null {
  return MODEL_CATALOG[provider].find((m) => m.id === modelId) ?? null;
}

/** 各プロバイダの既定モデル (未選択時のフォールバック)。標準ランクを既定にする。 */
export function defaultModelId(provider: AiProvider): string | null {
  const options = MODEL_CATALOG[provider];
  return options.find((m) => m.rank === "standard")?.id ?? options[0]?.id ?? null;
}

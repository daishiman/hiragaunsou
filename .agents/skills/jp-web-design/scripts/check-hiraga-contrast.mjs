#!/usr/bin/env node
// 平賀暫定カラーの主要ペアを検査する。本文4.5:1、非テキスト(入力枠・フォーカス・大きい文字)3:1。
// 避けるペアは「基準未満であること」を確認し、資料記載の値から逸脱していないかも見る。
// 使い方: node scripts/check-hiraga-contrast.mjs [css-path]
// 終了コード: 0=全PASS / 1=FAILあり / 2=CSS読込・解決エラー
// 画面全体の検査(axe等)や WCAG 全体への適合を置き換えない。

import { loadTokens, contrast, isHex } from './hiraga-tokens.mjs'

const TEXT = 4.5
const NON_TEXT = 3.0

// [前景, 背景, 基準, 用途]
const required = [
  ['text-primary', 'surface', TEXT, '本文×白'],
  ['text-primary', 'app-background', TEXT, '本文×画面背景'],
  ['text-secondary', 'surface', TEXT, '補助文字×白'],
  ['text-muted', 'surface', TEXT, '説明・プレースホルダー×白'],
  ['text-muted', 'surface-alt', TEXT, '説明×補助面'],
  ['text-heading', 'surface', TEXT, '見出し×白'],
  ['nav-text', 'nav-background', TEXT, 'ナビ文字×淡色面'],
  ['nav-text-muted', 'nav-background', TEXT, 'ナビ補助×淡色面'],
  ['nav-selected-text', 'nav-selected-bg', TEXT, 'ナビ選択'],
  ['action-primary-text', 'action-primary-bg', TEXT, '主ボタン'],
  ['action-primary-text', 'action-primary-hover', TEXT, '主ボタンhover'],
  ['action-primary-text', 'action-primary-active', TEXT, '主ボタン押下'],
  ['action-secondary-text', 'action-secondary-bg', TEXT, '副ボタン'],
  ['action-secondary-text', 'action-secondary-hover', TEXT, '副ボタンhover'],
  ['action-danger-text', 'action-danger-bg', TEXT, '危険ボタン'],
  ['action-danger-text', 'action-danger-hover', TEXT, '危険ボタンhover'],
  ['action-disabled-text', 'action-disabled-bg', TEXT, '無効ボタン'],
  ['link', 'surface', TEXT, 'リンク'],
  ['link-hover', 'surface', TEXT, 'リンクhover'],
  ['input-text', 'input-readonly-bg', TEXT, '読み取り専用'],
  ['input-placeholder', 'input-bg', TEXT, 'プレースホルダー'],
  ['input-invalid-message', 'surface', TEXT, 'エラーメッセージ'],
  ['required-text', 'required-bg', TEXT, '必須ラベル'],
  ['table-head-text', 'table-head-bg', TEXT, '表ヘッダー'],
  ['text-primary', 'table-stripe-bg', TEXT, '表の交互行'],
  ['text-primary', 'table-selected-bg', TEXT, '選択行'],
  ['tab-text-active', 'surface', TEXT, 'タブ選択'],
  ['pagination-active-text', 'pagination-active-bg', TEXT, '現在ページ'],
  ['tag-text', 'tag-bg', TEXT, '分類タグ'],
  ['badge-unread-text', 'badge-unread-bg', TEXT, '未読件数'],
  ['status-neutral-text', 'status-neutral-bg', TEXT, '状態:未処理'],
  ['status-info-text', 'status-info-bg', TEXT, '状態:情報'],
  ['status-success-text', 'status-success-bg', TEXT, '状態:成功'],
  ['status-warning-text', 'status-warning-bg', TEXT, '状態:注意'],
  ['status-danger-text', 'status-danger-bg', TEXT, '状態:エラー'],
  ['tooltip-text', 'tooltip-bg', TEXT, 'ツールチップ'],
  ['selection-text', 'selection-bg', TEXT, '選択文字'],
  ['input-border', 'input-bg', NON_TEXT, '入力枠×白'],
  ['control-off-border', 'surface', NON_TEXT, 'チェック枠×白'],
  ['control-on', 'surface', NON_TEXT, 'チェックON×白'],
  ['focus-ring', 'focus-gap', NON_TEXT, 'フォーカス×白'],
  ['focus-ring', 'nav-background', NON_TEXT, 'フォーカス×淡色ナビ'],
  ['progress-fill', 'progress-track', NON_TEXT, '進捗バー'],
  ['chart-main', 'surface', NON_TEXT, 'グラフ主系列'],
  ['chart-1', 'surface', NON_TEXT, 'グラフ系列1'],
  ['chart-2', 'surface', NON_TEXT, 'グラフ系列2'],
  ['chart-3', 'surface', NON_TEXT, 'グラフ系列3'],
  ['chart-4', 'surface', NON_TEXT, 'グラフ系列4'],
  ['chart-5', 'surface', NON_TEXT, 'グラフ系列5'],
  ['chart-threshold', 'surface', NON_TEXT, '閾値線']
]

// 使ってはいけないペア。基準未満であることを確認する(値が変わって基準を満たしたら、ルールの見直しが必要)。
const avoided = [
  ['p-brand-magenta', 'p-brand-indigo', TEXT, '紺地にマゼンタの小文字'],
  ['border-subtle', 'surface', NON_TEXT, '装飾罫線を入力欄の境界に使う']
]

let tokens
try {
  ;({ resolved: tokens } = await loadTokens(process.argv[2]))
} catch (error) {
  console.error(`ERROR ${error.message}`)
  process.exit(2)
}

let failed = false
const measure = (fg, bg) => {
  const a = tokens[fg]
  const b = tokens[bg]
  if (!isHex(a ?? '') || !isHex(b ?? '')) {
    console.error(`ERROR --${fg}(${a}) / --${bg}(${b}) は #RRGGBB に解決できません`)
    process.exit(2)
  }
  return contrast(a, b)
}

for (const [fg, bg, min, label] of required) {
  const value = measure(fg, bg)
  const pass = value >= min
  failed ||= !pass
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label} --${fg}/--${bg}: ${value.toFixed(2)}:1 (基準 ${min})`)
}
for (const [fg, bg, min, label] of avoided) {
  const value = measure(fg, bg)
  const pass = value < min
  failed ||= !pass
  console.log(`${pass ? 'AVOID' : 'FAIL'} ${label} --${fg}/--${bg}: ${value.toFixed(2)}:1 (基準 ${min} 未満であるべき)`)
}

if (failed) process.exitCode = 1

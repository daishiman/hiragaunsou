/* 月次データ取込: フォルダのCSV/Excelを渡すだけで、一覧表を作るTo-Be画面 */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const STEPS = [
    ['STEP 1', '車両別運行実績表', 'ITP-WEBServiceV3 CSV（3営業所）', '車番88888を傭車として自動除外。諸口・10/888/5000番は要確認として残す。'],
    ['STEP 2', '売上・車番別集計', '車楽クラウド CSV', '車番別に集計。キリン輸送協力金・経営支援金は24番・300番へ半額ずつ配賦。'],
    ['STEP 3', '燃料費', '給油レシート・外部給油請求書', 'CSV/Excelは自動読込、PDFはOCR読取の対象。アドブルーも車番別に集計。'],
    ['STEP 4', '人件費', 'ACELINK NX-CE CSV', '給与集計表（日給者）を車両・乗務員に紐付ける。'],
    ['STEP 5', '経費', '修繕・タイヤ請求書', '車番別に集計。請求書はPDF/OCR取込の対象。'],
    ['STEP 6', '高速料金', '高速協請求書', '車番別料金と個別割引額を集計。'],
    ['STEP 7', '収支表チェック', '全取込データ＋車両マスタ', '51列を自動計算。リース・割賦変更、重複・諸口だけ確認ボードへ。'],
    ['STEP 8', '月次成果物を確定', 'D1（月次DB）', 'Webの車両別収支表・年間比較・AI要因分析へ反映。Excelへの転記は不要。'],
  ]

  function stepRows() {
    return STEPS.map(([step, title, source, action]) => `<tr class="no-hover">
      <td class="tnum" style="font-weight:700;color:var(--brand-deep)">${C.esc(step)}</td>
      <td class="text" style="font-weight:600">${C.esc(title)}</td>
      <td class="text">${C.esc(source)}</td>
      <td class="text" style="white-space:normal;min-width:20rem">${C.esc(action)}</td>
    </tr>`).join('')
  }

  window.Views.import = function () {
    return `
      <div class="card rise-in" style="border-color:var(--brand);background:var(--brand-soft)">
        <div class="card-head">
          <h2>月次元データをまとめて取込</h2>
          <span class="badge badge-brand">ファイル名の月・日付変更に対応</span>
        </div>
        <p class="small muted" style="margin-top:0">利用者はCSV・Excel・PDFをフォルダから選ぶだけです。ファイル名ではなくCSV列見出しとExcelの「車番〜損益」51列で帳票種別を判定し、原本はR2、集計結果はD1に保存します。</p>
        <div class="dropzone" id="monthly-drop" style="margin-top:1rem;padding:1.4rem">
          2026年5月分のCSV / Excel / PDFをここにまとめてドラッグ&amp;ドロップ<br>
          <span class="xs">モックではアップロードをシミュレーションします</span>
        </div>
        <div id="monthly-import-result" class="xs muted" style="margin-top:0.6rem">未取込 — 完成済みExcelを選ぶと、5月の101台・51列一覧表をそのまま移行できます。</div>
      </div>

      <div class="card rise-in" style="--stagger:40ms;padding:1rem 1.2rem">
        <div class="card-head"><h2>作成業務フローをアプリに反映</h2><span class="sub">手入力ではなく、元データの取込→自動集計→例外確認</span></div>
        <div class="table-scroll"><table class="data"><thead><tr><th>工程</th><th>処理</th><th>元データ</th><th>アプリでの扱い</th></tr></thead><tbody>${stepRows()}</tbody></table></div>
      </div>

      <div class="card rise-in" style="--stagger:80ms">
        <div class="card-head"><h2>属人的な判断は「自動削除」しない</h2><span class="badge badge-caution">要確認として保存</span></div>
        <ul class="check-list">
          <li><span>車番88888（傭車）</span><span class="mark">確定ルール — 自動除外</span></li>
          <li><span>二重計上候補（10・888・5000番など）</span><span class="mark">請求担当への確認待ち</span></li>
          <li><span>運転者「諸口」</span><span class="mark">修正／削除を確認待ち</span></li>
          <li><span>キリン配賦の24番・300番</span><span class="mark">業務ルールとして自動配賦</span></li>
        </ul>
      </div>`
  }

  const previousAfterRender = window.Views.afterRender
  window.Views.afterRender = function (view, root) {
    if (previousAfterRender) previousAfterRender(view, root)
    if (view !== 'import') return
    const drop = root.querySelector('#monthly-drop')
    const result = root.querySelector('#monthly-import-result')
    const simulate = () => {
      drop.textContent = '取込完了（モック） — 帳票を判定し、原本と集計結果を保存しました'
      result.innerHTML = '<strong style="color:var(--brand-deep)">5月収支表: 101台・51列を生成</strong> ／ 傭車1件を自動除外 ／ 二重計上・諸口は確認ボードへ'
    }
    drop?.addEventListener('click', simulate)
    drop?.addEventListener('dragover', (event) => event.preventDefault())
    drop?.addEventListener('drop', (event) => { event.preventDefault(); simulate() })
  }
})()

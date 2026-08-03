/* データ設計ページ: 3層の要約 → 層ごとの接続マップ → 連鎖ルール/確認リスト(段階的開示) */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const MAP = [
    { item: '運行回数・稼働時間・稼働Km・燃費(分母)', layer: 1, src: 'デジタコ → 車楽', how: '車楽からCSVエクスポート定期取込(API有無を初回確認)', status: 'hypo' },
    { item: '運賃・附帯料金・伝票件数', layer: 1, src: '車楽(請求システム)', how: '同上', status: 'hypo' },
    { item: '道路使用料', layer: 1, src: 'デジタコETC → 車楽', how: '同上', status: 'hypo' },
    { item: '高速割引料', layer: 2, src: '道路使用料 × 割引率0.356', how: '率マスタから自動計算(率は設定画面で変更可)', status: 'fixed' },
    { item: '賞与', layer: 2, src: '規程(年40万円÷12)', how: '運転者が紐づけば自動', status: 'fixed' },
    { item: '福利厚生費', layer: 2, src: '社保合計', how: '給与データに含まれるなら自動、なければ料率マスタ×給与', status: 'hypo' },
    { item: '車検・タイヤ費(標準原価)', layer: 2, src: '原価計算シート(大型10.7円/km等)', how: '単価マスタ × 稼働Km で自動', status: 'fixed' },
    { item: '自賠責・任意保険/自動車税・重量税', layer: 2, src: '車両マスタ', how: '車検・更新イベント時のみマスタ更新 → 月割自動配賦', status: 'fixed' },
    { item: '車両リース・割賦', layer: 2, src: '車両マスタ(毎月支払額)', how: '契約時登録 → 毎月自動計上', status: 'fixed' },
    { item: '一般管理費', layer: 2, src: '売上 × 16.9%(3期平均)', how: '率マスタから自動(当面現行踏襲)', status: 'agree' },
    { item: '固定費・変動費・経費計・損益・利益率', layer: 2, src: '上記すべて', how: '現行Excelの定義式をそのまま実装。手入力は構造的に不可', status: 'fixed' },
    { item: '軽油代(インタンク/外部)・給油量', layer: 3, src: '燃料集計Excel(別担当作成)', how: '第1段: ファイルD&D自動パース / 第2段: 1次ソース直結', status: 'hypo' },
    { item: 'インタンク単価(円/ℓ)', layer: 3, src: '月次の仕入単価', how: '月1回入力 → 全車へ一括反映', status: 'fixed' },
    { item: '給与', layer: 3, src: '給与計算ソフト(製品名 要確認)', how: '総支給額のみCSV取込(取れなければ一括貼付UI)', status: 'hypo' },
    { item: '修理費(実費)', layer: 3, src: '修理伝票・請求書', how: '毎月入力(将来: 請求書OCR)。標準原価とは別フィールドで保持', status: 'agree' },
  ]

  const STATUS = {
    fixed: '<span class="badge badge-plain">確定</span>',
    hypo: '<span class="badge badge-caution">仮説 — 要ヒアリング</span>',
    agree: '<span class="badge badge-brand">方針合意が必要</span>',
  }

  const LAYER_HEAD = {
    1: '層① 自動流入 — 1次ソースから自動で入る(人間は触らない)',
    2: '層② 連鎖確定 — 入力とマスタから自動計算で決まる',
    3: '層③ 人間入力 — 毎月人間が入れる(5項目以内が目標)',
  }

  const QUESTIONS = [
    ['車楽のデータ出力手段(CSV/API/画面のみ)', '層①の接続方式が確定'],
    ['燃料集計Excelの1次ソースと作成手順', '層③の2項目を自動化できるか決まる'],
    ['給与ソフトの製品名と出力形式', '給与取込・福利厚生の自動算出が確定'],
    ['現状の月次工数の実測(入力・分析)', '効果測定の基準値が確定'],
    ['層③として残す項目の最終合意', 'ホームのToDo設計が確定'],
    ['修繕費の「推計」と「実費」の分離への同意', '実力損益が出せるようになる'],
    ['異常検知の閾値感覚(例月の何倍で疑うか)', '確認センターの検知ルールを調整'],
    ['レポート配信先(Slackか既存Kintoneか)', '月次レポートの届け先が決まる'],
    ['締め確定の運用(誰が・いつ・遡及修正ルール)', '権限と監査ログの仕様が確定'],
    ['遊休車9台の扱い(処分・予備の方針)', 'ダッシュボードでの表現が決まる'],
  ]

  window.Views.logic = function () {
    const hypoCount = MAP.filter((r) => r.status !== 'fixed').length

    const mapRows = [1, 2, 3].map((layer) => {
      const rows = MAP.filter((r) => r.layer === layer)
      return `<tr class="section-row no-hover"><td colspan="4">${LAYER_HEAD[layer]}</td></tr>` +
        rows.map((r) => `<tr class="no-hover">
          <td class="text" style="font-weight:600;white-space:normal;min-width:12rem">${C.esc(r.item)}</td>
          <td class="text" style="white-space:normal;min-width:11rem">${C.esc(r.src)}</td>
          <td class="text" style="white-space:normal;min-width:16rem">${C.esc(r.how)}</td>
          <td class="text">${STATUS[r.status]}</td>
        </tr>`).join('')
    }).join('')

    const qRows = QUESTIONS.map(([q, effect], i) => `<li>
        <span><span class="tnum muted" style="font-weight:700;margin-right:0.5rem">${String(i + 1).padStart(2, '0')}</span>
          ${C.esc(q)} <span class="xs muted">→ ${C.esc(effect)}</span></span>
        <span class="mark muted">未確定</span>
      </li>`).join('')

    return `
      <div class="card rise-in">
        <div class="step-flow">
          <div class="sf">
            <div class="sf-num">01 — 自動で入る</div>
            <div class="sf-title">デジタコ・ETC・車楽の売上</div>
            <p>すでに連携済みのデータ。人は何もしない。</p>
          </div>
          <div class="sf">
            <div class="sf-num">02 — 入力から連鎖して決まる</div>
            <div class="sf-title">保険・税・賞与・標準原価・管理費・損益</div>
            <p>車番・運転者・稼働Kmが決まると、マスタから自動計算。</p>
          </div>
          <div class="sf">
            <div class="sf-num">03 — 人が入れるのは5つだけ</div>
            <div class="sf-title">燃料・給与・修理費・単価・例外</div>
            <p>毎月合計30分以内が目標。</p>
          </div>
        </div>
      </div>

      <div class="card rise-in" style="--stagger:120ms;padding:1rem">
        <div class="card-head" style="padding:0 0.3rem">
          <h2>項目別の接続マップ</h2>
          <span class="sub">${MAP.length}項目中 ${hypoCount}項目がヒアリングで確定待ち</span>
        </div>
        <div class="table-scroll" style="border-radius:8px">
          <table class="data">
            <thead><tr><th>収支表の項目</th><th>1次ソース</th><th>決まり方</th><th>状態</th></tr></thead>
            <tbody>${mapRows}</tbody>
          </table>
        </div>
        <div class="note-caution" style="margin-top:0.8rem">
          原則: <strong>集計・損益などの下流の値は手入力できない構造</strong>にします(Excelで起きた年間集計への転記漏れを仕組みごと根絶)。
        </div>
        <details class="disclosure">
          <summary>連鎖反映の流れ(入力が決まると何が決まるか)</summary>
          <div class="disclosure-body flow-tree">
            <div class="node"><strong>月次シート作成(自動)</strong></div>
            <div class="lv">
              <div class="node">車両マスタ → 保険・税・リース・配賦単価が全車に即時セット</div>
              <div class="lv">
                <div class="node">[運転者名] 確定 → 賞与(規程)・給与枠(前月参照)がセット</div>
                <div class="node">[稼働Km] 流入 → 車検・タイヤ標準原価/燃費を自動計算</div>
                <div class="node">[売上] 流入 → 一般管理費(×16.9%)を自動計算</div>
                <div class="node">[道路使用料] 流入 → 高速割引(×0.356) → 運行費計</div>
                <div class="lv">
                  <div class="node">上流の確定ごとに → 損益・利益率・全社集計・対前年を即時再計算</div>
                  <div class="lv"><div class="node">再計算のたびに → 異常検知 → 確認センターにカード生成</div></div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div class="card rise-in" style="--stagger:160ms">
        <div class="card-head">
          <h2>ヒアリングで確定させること(${QUESTIONS.length}件)</h2>
          <span class="sub">モック提示時にこの画面で一緒に確認します</span>
        </div>
        <ul class="check-list">${qRows}</ul>
      </div>`
  }
})()

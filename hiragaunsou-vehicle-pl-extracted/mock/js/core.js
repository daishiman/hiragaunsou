/* コア: 状態・整形・集計ヘルパー。ビューはここの関数だけを使う */
(function () {
  'use strict'

  const D = window.APP_DATA
  const F = Object.fromEntries(D.fields.map((k, i) => [k, i]))

  const state = {
    view: 'home',
    ym: '2026-05',
    resolved: {}, // 異常値チェックの判定状態(カードid → 'fixed'|'approved')
    filters: { depot: '', vtype: '', deficitOnly: false },
    gridMode: 'summary', // グリッドのデフォルトは要約表示(デフォルト効果)
    regValues: {}, // 登録画面で埋めたセル(「車番|項目」 → 値)
    regShowAll: false, // 登録テーブル: デフォルトは未入力がある行だけ表示
  }

  /* ---------- 整形 ---------- */

  const yen = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    const n = Math.round(v)
    const s = Math.abs(n).toLocaleString('ja-JP')
    return n < 0 ? `▲${s}` : s
  }

  const man = (v) => {
    if (v === null || v === undefined) return '—'
    const sign = v < 0 ? '▲' : ''
    const a = Math.abs(v)
    if (a >= 100000000) return sign + (a / 100000000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '億円'
    return sign + (a / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円'
  }

  const pct = (v, digits = 1) =>
    v === null || v === undefined || Number.isNaN(v) ? '—' : (v * 100).toFixed(digits) + '%'

  const num = (v, digits = 0) =>
    v === null || v === undefined ? '—' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: digits })

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  /* ---------- データ取得 ---------- */

  const month = (ym) => D.months.find((m) => m.ym === (ym || state.ym))
  const val = (row, key) => row[F[key]]
  const numval = (row, key) => Number(row[F[key]]) || 0

  const sum = (rows, key) => rows.reduce((a, r) => a + numval(r, key), 0)

  const kmPrice = (row) => {
    const km = numval(row, 'km')
    return km > 0 ? numval(row, 'sales') / km : null
  }

  /* ---------- 赤字3分類(仮ルール — データ設計ページに開示) ---------- */

  const DEFICIT_RULES = {
    idleSales: 300000, // これ未満は遊休・低稼働扱い
    repairSpike: 300000, // 実費修理がこれ以上なら突発修繕型
    breakEvenKmPrice: 170, // km単価の損益分岐目安(円/km)
  }

  function classifyDeficit(rows) {
    const deficits = rows.filter((r) => numval(r, 'profit') < 0)
    const groups = { repair: [], idle: [], price: [] }
    deficits.forEach((r) => {
      if (numval(r, 'sales') < DEFICIT_RULES.idleSales) groups.idle.push(r)
      else if (numval(r, 'repair') >= DEFICIT_RULES.repairSpike) groups.repair.push(r)
      else groups.price.push(r)
    })
    return groups
  }

  /* ---------- 異常マップ(グリッドのセル強調用) ---------- */

  function colLetterToIndex(letters) {
    let n = 0
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }

  function anomalyCellMap() {
    // 車番 → {fieldKey: anomaly} (5月のみ)
    const map = {}
    D.anomalies.forEach((a) => {
      const fields = new Set()
      const re = /([A-Z]{1,2})(\d+)(?::([A-Z]{1,2})\d+)?/g
      let m
      while ((m = re.exec(a.cell)) !== null) {
        const from = colLetterToIndex(m[1])
        const to = m[3] ? colLetterToIndex(m[3]) : from
        for (let i = from; i <= to; i++) if (D.fields[i]) fields.add(D.fields[i])
      }
      if (!map[a.no]) map[a.no] = {}
      fields.forEach((f) => { map[a.no][f] = a })
    })
    return map
  }

  /* ---------- 月次集計 ---------- */

  function monthTotals(rows) {
    return {
      cars: rows.length,
      active: rows.filter((r) => numval(r, 'sales') > 0).length,
      sales: sum(rows, 'sales'),
      expense: sum(rows, 'expense'),
      profit: sum(rows, 'profit'),
      km: sum(rows, 'km'),
      tollNet: sum(rows, 'tollNet'),
      fuelTotal: sum(rows, 'fuelTotal'),
      repairTotal: sum(rows, 'repairTotal'),
      laborTotal: sum(rows, 'laborTotal'),
      insTotal: sum(rows, 'insTotal'),
      taxTotal: sum(rows, 'taxTotal'),
      transportTotal: sum(rows, 'transportTotal'),
      adminTotal: sum(rows, 'adminTotal'),
      deficitCars: rows.filter((r) => numval(r, 'profit') < 0).length,
      profitPos: sum(rows.filter((r) => numval(r, 'profit') > 0), 'profit'),
      profitNeg: sum(rows.filter((r) => numval(r, 'profit') < 0), 'profit'),
    }
  }

  /* ---------- 車両の12ヶ月履歴 ---------- */

  function vehicleHistory(no) {
    return D.months.map((m) => {
      const row = m.rows.find((r) => r[F.no] === no)
      return { ym: m.ym, label: m.label, row }
    })
  }

  /* ---------- バー部品(必ずラベル+数値) ---------- */

  function barRow(label, value, max, display, cls = '') {
    const w = max > 0 ? Math.max(1, Math.round((Math.abs(value) / max) * 100)) : 0
    return `<div class="bar-row">
      <div class="bar-label" title="${esc(label)}">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div>
      <div class="bar-value tnum ${value < 0 ? 'neg' : ''}">${display}</div>
    </div>`
  }

  /* ---------- 月タブ(表の直上に置き、その場で切り替える) ---------- */

  function monthTabs() {
    const tabs = D.months.map((m) => {
      const yearMark = m.label === '6月' ? '2025年' : m.label === '1月' ? '2026年' : ''
      return `<button class="month-tab ${m.ym === state.ym ? 'active' : ''}" data-month="${m.ym}">
        ${yearMark}${m.label}</button>`
    }).join('')
    return `<div class="month-tabs" role="tablist" aria-label="表示する月">${tabs}</div>`
  }

  window.Core = {
    D, F, state,
    yen, man, pct, num, esc,
    month, val, numval, sum, kmPrice,
    DEFICIT_RULES, classifyDeficit, anomalyCellMap,
    monthTotals, vehicleHistory, barRow, monthTabs,
  }
})()

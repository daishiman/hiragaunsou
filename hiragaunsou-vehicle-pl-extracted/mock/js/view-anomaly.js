/* 異常値チェック: 1画面1判断のキュー方式。
   12ヶ月の実データを並べたバーで「今月だけ違う」ことが説明なしで見える。
   判定すると自動で次へ進み、直前の判定はワンクリックで取り消せる */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const keyOf = (a) => a.no + a.item
  const PRIORITY_ORDER = { 高: 0, 中: 1, 低: 2 }
  // 高・中=入力ミスの可能性が高い → 「入力を直す」を推奨 / 低=実績の可能性が高い
  const recommendOf = (a) => (a.priority === '低' ? 'approved' : 'fixed')

  const FIELD_LABEL = {
    repair: '修理費(実費)', fuelOut: '軽油代(外部)', fuelIn: '軽油代(インタンク)',
    salary: '給与', welfare: '福利厚生費', km: '稼働Km', tollDisc: '高速割引料',
  }
  const KM_FIELDS = new Set(['km'])
  // チャートに使う項目の優先順(話の主役になりやすい順)
  const CHART_CANDIDATES = ['repair', 'fuelOut', 'salary', 'welfare', 'km', 'fuelIn', 'tollDisc']

  function colLetterToIndex(letters) {
    let n = 0
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }

  function fieldsOf(a) {
    const fields = []
    const re = /([A-Z]{1,2})(\d+)(?::([A-Z]{1,2})\d+)?/g
    let m
    while ((m = re.exec(a.cell)) !== null) {
      const from = colLetterToIndex(m[1])
      const to = m[3] ? colLetterToIndex(m[3]) : from
      for (let i = from; i <= to; i++) if (C.D.fields[i]) fields.push(C.D.fields[i])
    }
    return fields
  }

  function median(values) {
    if (values.length === 0) return 0
    const s = [...values].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }

  function chartFieldOf(a) {
    const fields = fieldsOf(a)
    const hist = C.vehicleHistory(a.no)
    for (const f of CHART_CANDIDATES) {
      if (!fields.includes(f)) continue
      const others = hist.filter((h) => h.row && h.ym !== '2026-05').map((h) => C.numval(h.row, f))
      if (median(others) > 0) return f
    }
    return fields[0]
  }

  const fmtOf = (field) => (v) => KM_FIELDS.has(field) ? `${C.num(v, 0)}km` : `${C.yen(v)}円`

  function sortedQueue() {
    return [...C.D.anomalies].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  }

  /* ---------- 描画 ---------- */

  window.Views.anomaly = function () {
    const queue = sortedQueue()
    const total = queue.length
    const open = queue.filter((a) => !C.state.resolved[keyOf(a)])
    const done = total - open.length

    if (open.length === 0) return doneView(queue)

    const current = queue.find((a) => keyOf(a) === C.state.currentAnomaly && !C.state.resolved[keyOf(a)]) || open[0]

    return `<div class="judge-wrap">
      <div class="judge-progress rise-in">
        <span class="count tnum">残り <span class="accent">${open.length}</span> / ${total}件</span>
        <div class="bar"><div style="width:${Math.round((done / total) * 100)}%"></div></div>
      </div>
      ${undoLine()}
      ${judgeCard(current)}
      ${queueList(queue, current)}
    </div>`
  }

  function undoLine() {
    const k = C.state.lastAnomalyAction
    if (!k) return ''
    const a = C.D.anomalies.find((x) => keyOf(x) === k)
    if (!a || !C.state.resolved[k]) return ''
    const label = C.state.resolved[k] === 'fixed' ? '修正待ちにしました' : 'この値で確定しました'
    return `<div class="undo-line rise-in">車番${C.esc(a.no)}を${label}
      <button class="btn btn-quiet" style="padding:0.15rem 0.7rem;font-size:0.72rem" data-undo="${C.esc(k)}">元に戻す</button></div>`
  }

  function judgeCard(a) {
    const field = chartFieldOf(a)
    const fmt = fmtOf(field)
    const hist = C.vehicleHistory(a.no)
    const cur = hist.find((h) => h.ym === '2026-05')
    const curVal = cur?.row ? C.numval(cur.row, field) : 0
    const otherVals = hist.filter((h) => h.row && h.ym !== '2026-05').map((h) => C.numval(h.row, field))
    const med = median(otherVals)
    const rec = recommendOf(a)

    const maxV = Math.max(curVal, ...otherVals, 1)
    const cols = hist.map((h) => {
      if (!h.row) return `<div class="col none" title="${h.label}: 在籍なし"></div>`
      const v = C.numval(h.row, field)
      const hPct = Math.max(2, Math.round((v / maxV) * 100))
      const isCur = h.ym === '2026-05'
      return `<div class="col ${isCur ? 'cur' : ''}" title="${h.label}: ${fmt(v)}">
        <div class="b" style="height:${hPct}%"></div></div>`
    }).join('')
    const labels = hist.map((h) =>
      `<span class="${h.ym === '2026-05' ? 'cur' : ''}">${h.label.replace('月', '')}</span>`).join('')
    const medPct = Math.round((med / maxV) * 100)

    const fixBtn = `<button class="btn ${rec === 'fixed' ? 'btn-cta' : 'btn-quiet'}" data-resolve="fixed" data-key="${C.esc(keyOf(a))}">
        入力ミス — 直しに送る${rec === 'fixed' ? '(推奨)' : ''}</button>`
    const okBtn = `<button class="btn ${rec === 'approved' ? 'btn-cta' : 'btn-quiet'}" data-resolve="approved" data-key="${C.esc(keyOf(a))}">
        これで正しい — 確定${rec === 'approved' ? '(推奨)' : ''}</button>`

    return `<div class="judge-card rise-in" style="--stagger:40ms">
      <div class="jc-head">
        <span class="jc-title">車番 ${C.esc(a.no)} の${FIELD_LABEL[field] || C.esc(a.item)}</span>
        <span class="xs muted">${C.esc(a.type)}${a.driver ? ' — ' + C.esc(a.driver) : ''}</span>
        ${a.priority === '低' ? '<span class="badge badge-plain">念のための確認</span>' : ''}
      </div>
      <div class="jc-numbers">
        <div><div class="k">今月(5月)</div><div class="v bad tnum">${fmt(curVal)}</div></div>
        <div><div class="k">いつもの月(中央値)</div><div class="usual tnum">${fmt(med)}</div></div>
      </div>
      <div class="spark">
        ${cols}
        <div class="median-line" style="bottom:${medPct}%"><span class="median-tag">いつもの月 ${fmt(med)}</span></div>
      </div>
      <div class="spark-labels">${labels}</div>
      <p class="small muted" style="margin:0.9rem 0 0">${C.esc(a.reason)}</p>
      <div class="judge-actions">
        ${rec === 'fixed' ? fixBtn + okBtn : okBtn + fixBtn}
      </div>
    </div>`
  }

  function queueList(queue, current) {
    const rows = queue.map((a) => {
      const k = keyOf(a)
      const st = C.state.resolved[k]
      const isCur = keyOf(current) === k && !st
      return `<button class="queue-row ${st ? 'done' : ''} ${isCur ? 'current' : ''}" data-pick="${C.esc(k)}">
        <span class="dot"></span>
        <span style="font-weight:600">車番 ${C.esc(a.no)}</span>
        <span class="muted">${C.esc(a.item)}</span>
        <span class="st">${st === 'fixed' ? '修正待ち' : st === 'approved' ? '確定済み' : isCur ? '判定中' : ''}</span>
      </button>`
    }).join('')
    return `<div class="queue-list rise-in" style="--stagger:80ms">${rows}</div>`
  }

  function doneView(queue) {
    return `<div class="judge-wrap">
      <div class="hero rise-in" style="text-align:center">
        <p class="hero-title">${queue.length}件すべて判定しました</p>
        <p class="hero-sub">5月度の締め確定に進めます(モックのため確定は動作しません)。</p>
        <button class="btn btn-cta" disabled>5月度を締め確定する</button>
      </div>
      ${undoLine()}
      ${queueList(queue, queue[0])}
    </div>`
  }

  /* ---------- 操作 ---------- */

  const prevAfter = window.Views.afterRender
  window.Views.afterRender = function (view, root) {
    if (prevAfter) prevAfter(view, root)
    if (view !== 'anomaly') return
    root.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.addEventListener('click', () => {
        C.state.resolved = { ...C.state.resolved, [btn.dataset.key]: btn.dataset.resolve }
        C.state.lastAnomalyAction = btn.dataset.key
        C.state.currentAnomaly = null
        window.App.render({ keepScroll: true })
      })
    })
    root.querySelectorAll('[data-undo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { [btn.dataset.undo]: _, ...rest } = C.state.resolved
        C.state.resolved = rest
        C.state.currentAnomaly = btn.dataset.undo
        C.state.lastAnomalyAction = null
        window.App.render({ keepScroll: true })
      })
    })
    root.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (C.state.resolved[btn.dataset.pick]) return
        C.state.currentAnomaly = btn.dataset.pick
        window.App.render()
      })
    })
  }
})()

/* ルーター: ナビ・ページヘッダー・月タブの結線 */
(function () {
  'use strict'
  const { D, state, esc } = window.Core

  const VIEWS = {
    home: {
      kind: 'ops', kindLabel: '毎月の運用', title: '', fixedYm: '2026-05',
      lead: '', render: () => window.Views.home(),
    },
    import: {
      kind: 'ops', kindLabel: '毎日の運用', title: 'データ登録', fixedYm: '2026-05',
      lead: 'デジタコのデータを都度追加し、足りない数字(黄色のセル)を入れるだけ。損益までその場で自動計算されます。',
      render: () => window.Views.import(),
    },
    anomaly: {
      kind: 'ops', kindLabel: '毎月の運用', title: '異常値チェック', fixedYm: '2026-05',
      lead: '1件ずつ表示します。グラフで「今月だけ違う」ことを確かめて、2択で判定するだけです。',
      render: () => window.Views.anomaly(),
    },
    grid: {
      kind: 'data', kindLabel: '現状データ(閲覧)', title: '月次収支表',
      lead: '現在のExcelと同じ表です。行をクリックすると車両ごとの12ヶ月が見られます。',
      render: () => window.Views.grid(),
    },
    annual: {
      kind: 'data', kindLabel: '現状データ(閲覧)', title: '年間集計・対前年',
      lead: '月次データからその場で自動集計。転記という作業はもうありません。',
      render: () => window.Views.annual(),
    },
    dashboard: {
      kind: 'analysis', kindLabel: '分析', title: '経営ダッシュボード',
      lead: 'その月の結果を4つの数字と2つの構造で要約します。',
      render: () => window.Views.dashboard(),
    },
    deficit: {
      kind: 'analysis', kindLabel: '分析', title: '赤字の理由(3分類)',
      lead: '赤字車両を原因別に自動分解します。「黒字か赤字か」で議論を止めないための画面です。',
      render: () => window.Views.deficit(),
    },
    logic: {
      kind: 'spec', kindLabel: '仕様の合意', title: 'データ設計 — 入力と自動化',
      lead: 'どの項目を人間が入力し、どこからが自動で決まるかの定義。「仮説」の行はヒアリングで差し替えます。',
      render: () => window.Views.logic(),
    },
  }

  const content = document.getElementById('content')

  function pageHead(v) {
    if (!v.title) return ''
    return `<div class="page-head rise-in">
      <div class="page-kind ${v.kind === 'ops' ? 'ops' : ''}">${esc(v.kindLabel)}</div>
      <h1>${esc(v.title)}</h1>
      ${v.lead ? `<p class="page-lead">${esc(v.lead)}</p>` : ''}
    </div>`
  }

  function render(opts = {}) {
    const v = VIEWS[state.view] || VIEWS.home
    if (v.fixedYm) state.ym = v.fixedYm // 運用画面は常に当月
    const scrollY = window.scrollY
    document.querySelectorAll('.nav-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === state.view))
    content.innerHTML = pageHead(v) + v.render()
    if (opts.keepScroll) {
      window.scrollTo(0, scrollY)
    } else {
      content.scrollTop = 0
      window.scrollTo(0, 0)
    }
    if (window.Views.afterRender) window.Views.afterRender(state.view, content)
    updateNavCounts()
  }

  function updateNavCounts() {
    const open = D.anomalies.filter((a) => !state.resolved[a.no + a.item]).length
    const el = document.getElementById('nav-anomaly-count')
    el.textContent = open > 0 ? String(open) : ''
    el.style.display = open > 0 ? '' : 'none'

    const regEl = document.getElementById('nav-reg-count')
    const missing = window.Views.regMissingCount ? window.Views.regMissingCount() : 0
    regEl.textContent = missing > 0 ? String(missing) : ''
    regEl.style.display = missing > 0 ? '' : 'none'
  }

  function go(view) {
    state.view = view
    location.hash = view
    render()
  }

  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.view)))

  // 月タブ・画面遷移リンクの委譲
  content.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-month]')
    if (tab) {
      state.ym = tab.dataset.month
      render({ keepScroll: true }) // その場で切り替え(スクロール位置を保つ)
      return
    }
    const nav = e.target.closest('[data-go]')
    if (nav) { e.preventDefault(); go(nav.dataset.go) }
  })

  window.App = { go, render }

  const initial = location.hash.replace('#', '')
  if (VIEWS[initial]) state.view = initial
  render()
})()

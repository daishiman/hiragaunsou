'use strict'

/* autoはdata-themeを外し、CSSのprefers-color-schemeへ委ねる。 */
const THEME_STORAGE_KEY = 'jp-web-design-theme'
const THEME_CHOICES = new Set(['auto', 'light', 'dark'])

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY) || 'auto'
    return THEME_CHOICES.has(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

function applyTheme(mode, persist = true) {
  const next = THEME_CHOICES.has(mode) ? mode : 'auto'
  if (next === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', next)

  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* storage unavailable */ }
  }

  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === next))
  })
}

/* CSSの読み込み前に保存済みテーマを反映し、ちらつきを防ぐ。 */
applyTheme(readTheme(), false)

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(readTheme(), false)
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice))
  })
})

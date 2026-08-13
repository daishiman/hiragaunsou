#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const defaultCss = fileURLToPath(new URL('../assets/reference/styles.css', import.meta.url))
const cssPath = process.argv[2] || defaultCss
const css = await readFile(cssPath, 'utf8')

function themeBlock(pattern, label) {
  const match = css.match(pattern)
  if (!match) throw new Error(`${label} theme block not found: ${cssPath}`)
  return Object.fromEntries(
    [...match[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((entry) => [entry[1], entry[2]])
  )
}

const themes = {
  light: themeBlock(/:root,\s*html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/, 'light'),
  dark: themeBlock(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/, 'dark')
}

function luminance(hex) {
  const values = hex.match(/[0-9a-fA-F]{2}/g).map((part) => Number.parseInt(part, 16) / 255)
  const [r, g, b] = values.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const pairs = [
  ['text', 'bg'],
  ['text-muted', 'surface'],
  ['primary-text', 'primary'],
  ['accent', 'surface'],
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['danger', 'danger-bg'],
  ['neutral', 'neutral-bg']
]

let failed = false
for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [foregroundName, backgroundName] of pairs) {
    const foreground = tokens[foregroundName]
    const background = tokens[backgroundName]
    if (!foreground || !background) throw new Error(`${themeName}: missing ${foregroundName} or ${backgroundName}`)
    const value = contrast(foreground, background)
    const pass = value >= 4.5
    failed ||= !pass
    console.log(`${pass ? 'PASS' : 'FAIL'} ${themeName} ${foregroundName}/${backgroundName}: ${value.toFixed(2)}:1`)
  }
}

if (failed) process.exitCode = 1

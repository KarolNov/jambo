import { describe, expect, it } from 'vitest'
import { COLOR_NAMES } from '../shared/colors'
import { contrast, cssVar, resolveTheme, SWATCHES, THEMES, TOKENS } from '../src/theme/palette'

describe('theme choice', () => {
  it("shows the theme this browser picked, else the system's", () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
    expect(resolveTheme('sepia', true)).toBe('dark')
  })
})

describe('palette', () => {
  it.each(THEMES)('keeps every collaborator colour at 3:1 or more on the %s surface', (theme) => {
    for (const c of COLOR_NAMES)
      expect(contrast(SWATCHES[c][theme], TOKENS[theme].bg), c).toBeGreaterThanOrEqual(3)
  })

  it.each(THEMES)('keeps text readable on the %s surface and plates', (theme) => {
    const t = TOKENS[theme]
    expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(7)
    expect(contrast(t.text, t.flat)).toBeGreaterThanOrEqual(7)
    expect(contrast(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5)
    // Both accents also colour small text (errors, Muted, Live, the recorder's phase): 4.5:1.
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.accent2, t.bg)).toBeGreaterThanOrEqual(4.5)
    // The status lights colour their word too (Live, Reconnecting…).
    expect(contrast(t.ok, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.info, t.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('publishes tokens under the CSS names the styles use', () => {
    expect(cssVar('bg')).toBe('--bg')
    expect(cssVar('accent2')).toBe('--accent-2')
    expect(Object.keys(TOKENS.light)).toEqual(Object.keys(TOKENS.dark))
  })
})

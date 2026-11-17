import { describe, expect, it } from 'vitest'
import { isJamSlug, newJamSlug } from '../shared/slug'

describe('jam slugs', () => {
  it('generates adjective-noun-suffix slugs that validate', () => {
    for (let i = 0; i < 200; i++) {
      const slug = newJamSlug()
      expect(slug).toMatch(/^[a-z]+-[a-z]+-[0-9a-z]{4}$/)
      expect(isJamSlug(slug)).toBe(true)
    }
  })

  it('gives two new jams in a row different slugs', () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => newJamSlug()))
    expect(slugs.size).toBeGreaterThan(995)
  })

  it.each([
    'funky-otter',
    'funky-otter-k7q2-x',
    'FUNKY-otter-k7q2',
    'notaword-otter-k7q2',
    'funky-notaword-k7q2',
    'funky-otter-k7qi',
    '../../etc',
    'not a slug',
    '',
  ])('rejects %j', (slug) => {
    expect(isJamSlug(slug)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
// Read as text: the catalogue renders React DOM, which doesn't typecheck or run in the Workers
// runtime the tests use.
import catalogue from '../src/ds/catalogue.tsx?raw'
import uiIndex from '../src/ui/index.ts?raw'
import design from '../DESIGN.md?raw'

/** The names src/ui/index.ts exports, split into components and types. */
function uiExports(source: string): { values: string[]; types: string[] } {
  const values: string[] = []
  const types: string[] = []
  for (const [, list] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
    for (const raw of list!.split(',')) {
      const item = raw.trim()
      if (!item) continue
      const [, isType, name] = /^(type\s+)?(\w+)$/.exec(item.replace(/\s+as\s+\w+$/, '')) ?? []
      if (name) (isType ? types : values).push(name)
    }
  return { values, types }
}

const { values, types } = uiExports(uiIndex)
const entries = [...catalogue.matchAll(/^\s*name:\s*['"`](\w+)['"`],?\s*$/gm)].map((m) => m[1]!)
const sections = [...design.matchAll(/^### `?(\w+)`?\s*$/gm)].map((m) => m[1]!)

describe('the design system', () => {
  it('reads every export of src/ui, so none slips past these checks', () => {
    const unread = (uiIndex.match(/^export\b.*$/gm) ?? []).filter(
      (line) => !/^export\s+(type\s+)?\{/.test(line),
    )
    expect(unread).toEqual([])
  })

  it('reads the exports of src/ui', () => {
    expect(values).toContain('Button')
    expect(values).toContain('Pad')
    expect(types).toContain('ButtonProps')
  })

  // @scenario ui: Browse the controls
  it('has a /ds catalogue entry for every src/ui component, and none for anything else', () => {
    expect(entries.toSorted()).toEqual(values.toSorted())
  })

  it('has a DESIGN.md section for every src/ui component, and none for anything else', () => {
    expect(sections.toSorted()).toEqual(values.toSorted())
  })

  it('names every exported src/ui type in DESIGN.md', () => {
    for (const t of types) expect(design, t).toContain(`\`${t}\``)
  })
})

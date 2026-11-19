import { type CSSProperties, useEffect, useState } from 'react'
import { COLOR_NAMES, type ColorName } from '../../shared/colors'
import { capitalize } from '../../shared/words'
import { cssVar, SWATCHES, type TokenName, TOKENS } from '../theme/palette'
import { useTheme } from '../theme/theme'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Select } from '../ui'
import { CATALOGUE } from './catalogue'
import './ds.css'

const DEPTHS = ['raise', 'raise-sm', 'raise-lg', 'inset', 'inset-sm', 'float'] as const

/**
 * The design showcase at /ds: every src/ui control with its states and rules, in the current
 * theme, with the theme switch and a collaborator colour that repaints the controls. Lazy-loaded
 * by App, so it doesn't grow the jam's bundle. The rules for agents are in DESIGN.md.
 */
export default function Showcase() {
  const theme = useTheme()
  const [color, setColor] = useState<ColorName>('teal')
  const paint = SWATCHES[color][theme]

  // Focus rings in the picked colour, set on <html> so popovers (in <body>) get them too, as a
  // jam does with your colour.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--focus', paint)
    return () => {
      root.removeProperty('--focus')
    }
  }, [paint])

  return (
    <main className="ds" style={{ '--ui-c': paint, '--glow': paint } as CSSProperties}>
      <header className="ds-header">
        <div>
          <h1>jambo design system</h1>
          <p className="ds-muted">
            The shared controls in <code>src/ui</code>, live. Hover, focus (Tab) and press work on
            every demo. Agents: the same rules are in <code>DESIGN.md</code>.
          </p>
        </div>
        <div className="ds-tools">
          <Select
            label="Collaborator colour"
            value={color}
            onChange={(v) => setColor(v as ColorName)}
            groups={[
              {
                options: COLOR_NAMES.map((c) => ({
                  value: c,
                  label: capitalize(c),
                  dot: { color: SWATCHES[c][theme], title: capitalize(c) },
                })),
              },
            ]}
          />
          <ThemeToggle />
        </div>
      </header>

      <nav className="ds-nav" aria-label="Controls">
        <a href="#foundations">Foundations</a>
        {CATALOGUE.map((e) => (
          <a key={e.name} href={`#${e.name}`}>
            {e.name}
          </a>
        ))}
      </nav>

      <section id="foundations" className="ds-entry">
        <h2>Foundations</h2>
        <p className="ds-muted">
          One surface lit from the top left. Raised means you can press it; inset means it holds a
          value or is pressed in; float is for things over the page.
        </p>
        <div className="ds-tokens">
          {(Object.keys(TOKENS[theme]) as TokenName[]).map((t) => (
            <figure key={t} className="ds-token">
              <span style={{ background: TOKENS[theme][t] }} />
              <figcaption>
                <code>{cssVar(t)}</code> {TOKENS[theme][t]}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="ds-depths">
          {DEPTHS.map((d) => (
            <figure key={d} className="ds-depth">
              <span style={{ boxShadow: `var(--${d})` }} />
              <figcaption>
                <code>--{d}</code>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {CATALOGUE.map((e) => (
        <section key={e.name} id={e.name} className="ds-entry">
          <h2>
            <code>{e.name}</code>
          </h2>
          <p className="ds-muted">{e.summary}</p>
          <div className="ds-states">
            {e.states.map((s) => (
              <figure key={s.label} className="ds-state">
                <div className="ds-demo">{s.demo}</div>
                <figcaption>{s.label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="ds-rules">
            <div>
              <h3>Use it for</h3>
              <ul>
                {e.use.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Not for</h3>
              <ul>
                {e.avoid.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}
    </main>
  )
}

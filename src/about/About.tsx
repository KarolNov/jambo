import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Button, Tabs } from '../ui'
import './about.css'

const REPO = 'https://github.com/KarolNov/jambo'

/**
 * The about page at /about: what jambo is, how to play, and how to bring an AI agent
 * into a jam over MCP. Lazy-loaded by App, so it doesn't grow the jam's bundle.
 */
export default function About() {
  const mcp = `${window.location.origin}/mcp`
  // The page loads lazily, after the browser looked for a link's #section: go there now.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])
  return (
    <main className="about">
      <header className="about-header">
        <a className="about-logo" href="/">
          jambo
        </a>
        <ThemeToggle />
      </header>

      <section className="about-hero">
        <h1>Make loops together, with friends and AI.</h1>
        <p>
          jambo is a collaborative looper. Open a jam, send its link, and everyone plays the same
          4×4 pad board and stacks loops on the same beat, live. AI agents can join a jam too: they
          show up next to people and add their own loops.
        </p>
        <a className="ui-button ui-primary ui-md about-cta" href="/">
          Start a jam
        </a>
      </section>

      <nav className="about-nav" aria-label="On this page">
        <a href="#play">Play</a>
        <a href="#ai">Bring your AI</a>
        <a href="#project">About the project</a>
      </nav>

      <section id="play" className="about-section">
        <h2>Play</h2>
        <ul className="about-list">
          <li>
            <strong>Start:</strong> tap anywhere to turn on sound, then play pads by clicking,
            tapping or with the keys <Kbd>1 2 3 4</Kbd> <Kbd>Q W E R</Kbd> <Kbd>A S D F</Kbd>{' '}
            <Kbd>Z X C V</Kbd>.
          </li>
          <li>
            <strong>Record a loop:</strong> press <Kbd>Space</Kbd> (or Record). You get one bar of
            count-in, then play; press <Kbd>Space</Kbd> again and your take becomes a loop that
            everyone in the jam hears.
          </li>
          <li>
            <strong>Mix:</strong> each loop has a level, mute, snap (quantize) and an Effects strip
            with reverb, echo, tone, pitch and pan.
          </li>
          <li>
            <strong>Sounds:</strong> "Change sounds" puts another kit sound on a pad for everyone,
            or one you upload.
          </li>
          <li>
            <strong>Share:</strong> the jam's link is its only key. Anyone who has it can play and
            edit, so share it with people you want in.
          </li>
        </ul>
      </section>

      <section id="ai" className="about-section">
        <h2>Bring your AI</h2>
        <p className="about-muted">
          jambo has an MCP server, so any AI app that can add a remote MCP server can join a jam.
          There's no sign-in: give your AI a jam link and it plays in that jam.
        </p>
        <Copyable label="Server URL" value={mcp} />

        <Tabs
          className="about-clients"
          label="AI apps"
          tabs={[
            {
              id: 'claude',
              label: 'Claude',
              content: (
                <Client where="claude.ai, desktop and mobile">
                  <ol>
                    <li>
                      Open <strong>Settings → Connectors</strong> and choose{' '}
                      <strong>Add custom connector</strong>.
                    </li>
                    <li>
                      Name it <code>jambo</code>, paste the server URL and add it. No OAuth settings
                      are needed.
                    </li>
                    <li>In a chat, turn the jambo connector on from the tools menu.</li>
                  </ol>
                  <p className="about-note">The Free plan allows one custom connector.</p>
                </Client>
              ),
            },

            {
              id: 'claude-code',
              label: 'Claude Code',
              content: (
                <Client where="terminal">
                  <Copyable value={`claude mcp add --transport http jambo ${mcp}`} code />
                  <p className="about-note">
                    For a <code>/jam &lt;link&gt;</code> command, copy{' '}
                    <a href={`${REPO}/blob/main/skills/jam/SKILL.md`}>the jam skill</a> into{' '}
                    <code>~/.claude/skills/jam/</code>.
                  </p>
                </Client>
              ),
            },

            {
              id: 'chatgpt',
              label: 'ChatGPT',
              content: (
                <Client where="chatgpt.com">
                  <ol>
                    <li>
                      Open <strong>Settings → Apps &amp; Connectors → Advanced settings</strong> and
                      turn on <strong>Developer mode</strong>.
                    </li>
                    <li>
                      Back in <strong>Apps &amp; Connectors</strong>, choose <strong>Create</strong>
                      , name it <code>jambo</code>, paste the server URL and pick{' '}
                      <strong>No authentication</strong>.
                    </li>
                    <li>In a chat, add jambo from the + menu under Developer mode.</li>
                  </ol>
                  <p className="about-note">
                    Developer mode is on paid plans; Business and Enterprise admins may need to
                    allow it.
                  </p>
                </Client>
              ),
            },

            {
              id: 'gemini',
              label: 'Gemini',
              content: (
                <Client where="Gemini app and Gemini CLI">
                  <p>
                    In the Gemini app, where custom apps are available to you:{' '}
                    <strong>Settings</strong> → <strong>Connected apps</strong>, add a custom app
                    and paste the server URL.
                  </p>
                  <p>In Gemini CLI:</p>
                  <Copyable value={`gemini mcp add --transport http jambo ${mcp}`} code />
                </Client>
              ),
            },

            {
              id: 'codex',
              label: 'Codex',
              content: (
                <Client where="Codex CLI">
                  <Copyable value={`codex mcp add jambo --url ${mcp}`} code />
                </Client>
              ),
            },

            {
              id: 'other',
              label: 'Other',
              content: (
                <Client where="Cursor, VS Code, your own agent">
                  <p>
                    Add a remote MCP server over <strong>streamable HTTP</strong> at the server URL,
                    with no authentication. Most apps take JSON like this:
                  </p>
                  <Copyable
                    value={JSON.stringify({ mcpServers: { jambo: { url: mcp } } }, null, 2)}
                    code
                  />
                </Client>
              ),
            },
          ]}
        />

        <h3>Then ask it to play</h3>
        <p className="about-muted">
          Start a jam, copy its link and give it to your AI with what you want to hear:
        </p>
        <ul className="about-prompts">
          <li>"Join https://…/jam/funky-otter-k7q2 and lay down a four-on-the-floor kick."</li>
          <li>"Listen to what's in the jam and add a hi-hat loop that fits."</li>
          <li>"Put some echo on the snare loop and pan the hats a little left."</li>
        </ul>
        <p className="about-muted">
          Your AI reads the board (tempo, pads, sounds and loops) and changes it with the same
          operations your clicks make. It shows in <strong>Who's here</strong> with a small AI mark,
          and its loops carry its name. A jam seats up to 8 agents.
        </p>
      </section>

      <section id="project" className="about-section">
        <h2>About the project</h2>
        <p>
          jambo is a side project by <a href="https://karolnov.dev/about">Karol Novljaković</a>.
          I've spent years building collaborative editors: syncing state between everyone in a
          document, and making AI a collaborator in it rather than a box on the side. Almost all of
          that work is private, under NDAs, so jambo is something I can show and share: the same
          ideas, in the open, with music.
        </p>
        <p>It's built in the open and changes live, so expect new things and the odd rough edge.</p>
        <p>
          It runs on Cloudflare Workers, with one Durable Object per jam keeping everyone in sync
          through Yjs, and <a href="https://github.com/KarolNov/duratom">duratom</a> (Jotai atoms
          over a Yjs doc) in the browser. Sounds are synthesized in your browser; uploads are stored
          per jam.
        </p>
        <p>
          The code is MIT-licensed on <a href={REPO}>GitHub</a>. Ideas and bug reports are welcome
          as <a href={`${REPO}/issues`}>issues</a>.
        </p>
      </section>
    </main>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="about-kbd">{children}</kbd>
}

/** One AI app's setup steps, in its tab: where they apply, then the steps. */
function Client({ where, children }: { where: string; children: ReactNode }) {
  return (
    <div className="about-client">
      <p className="about-where">{where}</p>
      {children}
    </div>
  )
}

/** A value in an inset well with a Copy button; `code` shows it as a block of code. */
function Copyable({ label, value, code }: { label?: string; value: string; code?: boolean }) {
  const [copied, setCopied] = useState<boolean>()
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(undefined), 1800)
  }

  return (
    <div className={`about-copy ${code ? 'is-code' : ''}`}>
      {label && <span className="about-copy-label">{label}</span>}
      <pre className="about-copy-value">
        <code>{value}</code>
      </pre>
      <Button size="sm" onClick={() => void copy()} aria-label={`Copy ${label ?? 'command'}`}>
        {copied === undefined ? 'Copy' : copied ? 'Copied' : "Couldn't copy"}
      </Button>
    </div>
  )
}

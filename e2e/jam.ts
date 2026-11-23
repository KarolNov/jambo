/**
 * What the e2e tests share: people (one browser context each, so each gets its own identity),
 * jams started the way a person starts one, the parts of the console tests reach for, and an
 * agent that acts through the real MCP endpoint.
 */
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test'
import { installAudioProbe, type Probe } from './probe'

export interface Person {
  context: BrowserContext
  page: Page
}

/** A new person: their own browser context (storage, identity), with the audio probe installed. */
export async function person(browser: Browser, setup?: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext()
  await context.addInitScript(installAudioProbe)
  await setup?.(context)
  const page = await context.newPage()
  return { context, page }
}

/** Opens `/` and waits for the new jam's board, live. Returns the jam's link. */
export async function startJam(page: Page): Promise<string> {
  await page.goto('/')
  await page.waitForURL(/\/jam\/[a-z0-9-]+$/)
  await expectLive(page)
  return page.url()
}

/** Opens a jam's link and waits until it is live. */
export async function openJam(page: Page, link: string) {
  await page.goto(link)
  await expectLive(page)
}

export const slugOf = (link: string) => new URL(link).pathname.split('/').pop()!

export const status = (page: Page) => page.locator('.console-status')

export async function expectLive(page: Page) {
  await expect(status(page)).toHaveText('Live')
}

export const people = (page: Page) => page.getByRole('list', { name: "Who's here" }).locator('li')

/** Starts the page's audio, as the first tap does. */
export async function startAudio(page: Page) {
  const unlock = page.getByRole('button', { name: 'Tap to start audio' }).first()
  await unlock.click()
  await expect(unlock).toBeHidden()
}

export const recordButton = (page: Page) => page.locator('.console-record')

/** The readout's phase: 'idle' between takes, else 'waiting', 'count-in' or 'recording'. */
export const phase = (page: Page) => recordButton(page).getAttribute('data-phase')

/** Waits until the clock is agreed, so Record starts a take straight away. */
export async function expectSynced(page: Page) {
  await expect(recordButton(page)).not.toHaveAttribute('aria-busy', 'true')
}

/**
 * Records a take through the transport: Space, then once recording each of `keys` (pad keys) a
 * beat apart, then Space to stop. Returns once the take is stopped.
 */
export async function recordTake(page: Page, keys: string[], beatMs = 600) {
  await expectSynced(page)
  await page.keyboard.press('Space')
  await expect(recordButton(page)).toHaveAttribute('data-phase', 'recording', { timeout: 8_000 })
  for (const key of keys) {
    await page.keyboard.press(key)
    await page.waitForTimeout(beatMs)
  }
  await page.keyboard.press('Space')
  await expect(recordButton(page)).toHaveAttribute('data-phase', 'idle')
}

/** The mixer's loop rows. */
export const loops = (page: Page) =>
  page.getByRole('region', { name: 'Loops' }).locator('.console-channel')

export const loopNames = (page: Page) => page.getByRole('textbox', { name: 'Loop name' })

// page.evaluate sends a function's source to the page, so each reads the probe inline.

/** When each metronome click this page played is heard, in Unix ms (from the audio probe). */
export const clicksHeard = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.clicks())

/** Each loop's reverb send on this page, as last set (from the audio probe). */
export const reverbSends = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.reverb())

let rpcId = 0

/**
 * Calls a jambo MCP tool the way an agent's client does, against the local Worker. Returns the
 * tool's parsed JSON answer.
 */
export async function agentCall(
  request: APIRequestContext,
  name: 'join' | 'run' | 'leave',
  args: Record<string, unknown>,
) {
  const res = await request.post('/mcp', {
    headers: {
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    data: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } },
  })
  expect(res.ok()).toBe(true)
  const text = await res.text()
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .join('')
  const { result, error } = JSON.parse(data || text) as {
    result?: { isError?: boolean; content: { text: string }[] }
    error?: { message: string }
  }
  if (error) throw new Error(error.message)
  if (result!.isError) throw new Error(result!.content[0]!.text)
  return JSON.parse(result!.content[0]!.text) as Record<string, any>
}

/** Has an agent add a one-bar loop of four hits on the first pad. Returns the agent's answer. */
export const agentAddsLoop = (request: APIRequestContext, link: string, name = 'Kicks') =>
  agentCall(request, 'run', {
    jam: slugOf(link),
    kind: 'Claude',
    summary: `Adds ${name}`,
    ops: [
      {
        op: 'addTrack',
        track: { name, bars: 1, hits: [0, 1, 2, 3].map((beat) => ({ padId: 'r0c0', beat })) },
      },
    ],
  })

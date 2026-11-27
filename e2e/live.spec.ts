/**
 * Live voice end to end on the fake transport: one person's microphone (Chromium's fake one)
 * through the mic control, their preset, the encoder, the local Worker's relay and other people's
 * jitter buffers and playback worklets; Who's here's live marks and mutes; and a take sung while
 * live. The `?debug` readout exposes what was sent and played.
 */
import { type Browser, expect, type Page, test } from '@playwright/test'
import { LIVE } from '../shared/live'
import { barMs } from '../shared/looper'
import {
  agentCall,
  closePeople,
  expectSynced,
  loops,
  openJam,
  person,
  recordButton,
  slugOf,
  startAudio,
  startJam,
} from './jam'
import { ensureMic } from './mic'

test.afterEach(closePeople)

interface Played {
  voice: string
  seq: number
  stamp: number
  at: number
}

/** What `window.__jamboLive` (the `?debug` readout's live voice) has sent and played. */
const stats = (page: Page) =>
  page.evaluate(() => {
    const live = (
      window as unknown as {
        __jamboLive?: { stats: { sent: number; lastSent?: { stamp: number }; played: Played[] } }
      }
    ).__jamboLive
    if (!live) return { sent: 0, lastStamp: undefined, played: [] as Played[] }
    return {
      sent: live.stats.sent,
      lastStamp: live.stats.lastSent?.stamp,
      played: [...live.stats.played],
    }
  })

const liveMic = (page: Page) => page.getByRole('button', { name: 'Live mic' })

const whosHere = (page: Page) => page.getByRole('list', { name: "Who's here" })

/** Who's here's entries the room lists as live. */
const liveMarks = (page: Page) => whosHere(page).getByRole('listitem', { name: /, live$/ })

/** Turns the live mic on, confirming headphones if asked, and waits until it is live. */
async function goLive(page: Page) {
  await liveMic(page).click()
  const sure = page.getByRole('button', { name: "I'm wearing headphones" })
  if (await sure.isVisible()) await sure.click()
  await expect(liveMic(page)).toHaveAttribute('aria-pressed', 'true')
}

/** Someone with a (fake) microphone they may use. */
const singer = (browser: Browser, baseURL: string | undefined) =>
  person(browser, async (c) => {
    await c.grantPermissions(['microphone'])
    await ensureMic(c, `${baseURL}/about`)
  })

/** Opens `link` with the debug readout, starts audio, and waits for the clock. */
async function join(page: Page, link: string) {
  await openJam(page, `${link}?debug`)
  await startAudio(page)
  await expectSynced(page)
}

/** How many frames `page` has played so far, across every voice (it keeps the last 200). */
const playedCount = async (page: Page) => (await stats(page)).played.length

// @scenario collab/live-voice: First time live
// @scenario collab/live-voice: On the beat, a bar later
// @scenario collab/live-voice: Turn it off
// @scenario board/session: Someone goes live
test("one person's live voice plays for another exactly one bar after it was sung", async ({
  browser,
  baseURL,
}) => {
  const a = await singer(browser, baseURL)
  const b = await person(browser)
  const link = await startJam(a.page)
  await join(a.page, link)
  await join(b.page, link)

  // The first time, the live mic asks about headphones, and goes live only once they confirm.
  await liveMic(a.page).click()
  await expect(a.page.getByRole('group', { name: 'Headphones' })).toBeVisible()
  await a.page.getByRole('button', { name: 'Not now' }).click()
  await expect(liveMic(a.page)).toHaveAttribute('aria-pressed', 'false')
  await expect(liveMarks(b.page)).toHaveCount(0)
  await liveMic(a.page).click()
  await a.page.getByRole('button', { name: "I'm wearing headphones" }).click()
  await expect(liveMic(a.page)).toHaveAttribute('aria-pressed', 'true')
  // Everyone sees A live, A too.
  await expect(liveMarks(b.page)).toHaveCount(1)
  await expect(liveMarks(a.page)).toHaveAccessibleName(/\(you\), live$/)
  // A bar of delay, plus the microphone starting: then a second of voice has played for B.
  await expect
    .poll(async () => (await stats(b.page)).played.length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(50)

  // A stamps each frame with the room time it was sung: a moment ago, never in the future.
  const sung = await stats(a.page)
  const now = await a.page.evaluate(() => Date.now())
  expect(sung.sent).toBeGreaterThanOrEqual(50)
  expect(now - sung.lastStamp!).toBeGreaterThanOrEqual(0)
  expect(now - sung.lastStamp!).toBeLessThan(500)

  // Every frame B played went out one bar after its stamp, at the jam's 100 BPM.
  const { played } = await stats(b.page)
  const offBar = played.map((p) => p.at - p.stamp - barMs(100))
  test.info().annotations.push({
    type: 'widest miss of a bar',
    description: `${Math.max(...offBar.map(Math.abs)).toFixed(2)} ms over ${played.length} frames`,
  })
  for (const off of offBar) expect(Math.abs(off)).toBeLessThan(30)
  // Frames came on time, one after another: next to none were lost on the way.
  const seqs = played.map((p) => p.seq)
  expect(seqs.at(-1)! - seqs[0]! + 1 - seqs.length).toBeLessThanOrEqual(2)
  // B never hears itself: everything played is A's voice.
  expect(new Set(played.map((p) => p.voice)).size).toBe(1)
  expect((await stats(a.page)).played).toHaveLength(0)

  // Turned off: within a bar B hears nothing more of A, and A's live mark goes.
  await liveMic(a.page).click()
  await expect(liveMic(a.page)).toHaveAttribute('aria-pressed', 'false')
  await expect(liveMarks(b.page)).toHaveCount(0)
  await b.page.waitForTimeout(barMs(100) + 500)
  const stopped = (await stats(b.page)).played.length
  await b.page.waitForTimeout(1_000)
  expect((await stats(b.page)).played.length).toBe(stopped)
  // The browser remembers the headphones: going live again doesn't ask.
  await liveMic(a.page).click()
  await expect(liveMic(a.page)).toHaveAttribute('aria-pressed', 'true')
  await expect(a.page.getByRole('group', { name: 'Headphones' })).toBeHidden()
})

// @scenario collab/live-voice: Fourth singer
test('a fourth person turning their mic on is told the jam is full, and nobody hears them', async ({
  browser,
  baseURL,
}) => {
  const singers = [] as Awaited<ReturnType<typeof singer>>[]
  for (let i = 0; i <= LIVE.maxVoices; i++) singers.push(await singer(browser, baseURL))
  const link = await startJam(singers[0]!.page)
  for (const s of singers) await join(s.page, link)
  const fourth = singers.at(-1)!.page

  for (const s of singers.slice(0, LIVE.maxVoices)) await goLive(s.page)
  await expect(liveMarks(fourth)).toHaveCount(LIVE.maxVoices)

  await liveMic(fourth).click()
  await fourth.getByRole('button', { name: "I'm wearing headphones" }).click()
  await expect(fourth.getByRole('alert')).toHaveText(
    `This jam is full of live voices (${LIVE.maxVoices} at once).`,
  )
  await expect(liveMic(fourth)).toHaveAttribute('aria-pressed', 'false')
  expect((await stats(fourth)).sent).toBe(0)
  await expect(liveMarks(singers[0]!.page)).toHaveCount(LIVE.maxVoices)
})

// @scenario collab/live-voice: Mute for me
test('a listener who mutes a live voice stops hearing it, and the other listener still does', async ({
  browser,
  baseURL,
}) => {
  const a = await singer(browser, baseURL)
  const b = await person(browser)
  const c = await person(browser)
  const link = await startJam(a.page)
  for (const p of [a, b, c]) await join(p.page, link)
  await goLive(a.page)
  for (const p of [b, c])
    await expect.poll(() => playedCount(p.page), { timeout: 15_000 }).toBeGreaterThan(20)

  // Only someone else live has a mute button: A has none for themself.
  await expect(whosHere(a.page).getByRole('button', { name: /^Mute / })).toHaveCount(0)
  const mute = whosHere(b.page).getByRole('button', { name: /^Mute / })
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  const muted = await stats(b.page)
  await b.page.waitForTimeout(1_500)
  // B hears nothing more of A; C still does. (The readout keeps 200 frames: compare the last.)
  expect((await stats(b.page)).played.at(-1)?.seq).toBe(muted.played.at(-1)?.seq)
  const cAfter = await stats(c.page)
  expect(cAfter.played.at(-1)!.seq).toBeGreaterThan(muted.played.at(-1)!.seq + 20)

  // Unmuted, B hears A again from their next on-time frame.
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await expect
    .poll(async () => (await stats(b.page)).played.at(-1)?.seq ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(muted.played.at(-1)!.seq + 20)
})

// @scenario collab/live-voice: Keep a phrase
test('a phrase sung into a take while live is kept as a clip, and everyone hears it live', async ({
  browser,
  baseURL,
  request,
}) => {
  const a = await singer(browser, baseURL)
  const b = await person(browser)
  const link = await startJam(a.page)
  await join(a.page, link)
  await join(b.page, link)
  await goLive(a.page)
  await expect.poll(() => playedCount(b.page), { timeout: 15_000 }).toBeGreaterThan(20)

  // 100 BPM: 600 ms a beat. Record, and once the take runs hold M from about beat 4 to beat 6.
  const sing = a.page.getByRole('button', { name: /^Sing/ })
  await a.page.keyboard.press('Space')
  await expect(recordButton(a.page)).toHaveAttribute('data-phase', 'recording', {
    timeout: 8_000,
  })
  const recording = Date.now()
  await expect(sing).toBeEnabled()
  await a.page.waitForTimeout(4 * 600 - (Date.now() - recording))
  await a.page.keyboard.down('m')
  await expect(sing).toHaveAttribute('aria-pressed', 'true')
  await a.page.waitForTimeout(2 * 600)
  await a.page.keyboard.up('m')
  const heardDuring = (await stats(b.page)).played.at(-1)!.seq
  await a.page.waitForTimeout(7.4 * 600 - (Date.now() - recording))
  await a.page.keyboard.press('Space')
  await expect(recordButton(a.page)).toHaveAttribute('data-phase', 'idle')

  // A stayed live throughout, and B kept hearing them.
  await expect(liveMic(a.page)).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(async () => (await stats(b.page)).played.at(-1)!.seq)
    .toBeGreaterThan(heardDuring)

  // The take holds the phrase as a clip near beat 4.
  await expect(loops(b.page)).toHaveCount(1, { timeout: 15_000 })
  await expect(loops(b.page).first().locator('.console-clip')).toHaveCount(1)
  const jam = await agentCall(request, 'join', { jam: slugOf(link), kind: 'Claude' })
  const [track] = jam.board.tracks as { hits: { soundId?: string; beat: number }[] }[]
  const clip = track!.hits.find((h) => h.soundId)
  expect(clip).toBeDefined()
  expect(clip!.beat).toBeGreaterThan(3.5)
  expect(clip!.beat).toBeLessThan(5.5)
})

// @scenario collab/live-voice: Can't encode
test("a browser that can't encode a live voice has its mic control disabled, and still hears others", async ({
  browser,
  baseURL,
}) => {
  const a = await singer(browser, baseURL)
  const b = await person(browser, async (c) => {
    await c.addInitScript(() => {
      delete (window as { AudioEncoder?: unknown }).AudioEncoder
    })
  })
  const link = await startJam(a.page)
  await join(a.page, link)
  await join(b.page, link)

  await expect(liveMic(b.page)).toBeDisabled()
  await expect(liveMic(b.page)).toHaveAccessibleDescription("This browser can't sing live.")
  await goLive(a.page)
  await expect.poll(() => playedCount(b.page), { timeout: 15_000 }).toBeGreaterThan(20)
})

// @scenario collab/live-voice: Not set up here
test("where live voice isn't set up, the mic control is disabled and says so", async ({
  browser,
}) => {
  // A deployed Worker without Realtime credentials answers `none`, as this one is told to.
  const a = await person(browser, async (c) => {
    await c.route('**/api/live', (route) => route.fulfill({ json: { transport: 'none' } }))
  })
  const link = await startJam(a.page)
  await join(a.page, link)
  await expect(liveMic(a.page)).toBeDisabled()
  await expect(liveMic(a.page)).toHaveAccessibleDescription("Live voice isn't available here.")
})

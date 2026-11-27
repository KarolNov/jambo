/**
 * Live voice end to end on the fake transport: one person's microphone (Chromium's fake one)
 * through their preset, the encoder, the local Worker's relay and another person's jitter buffer
 * and playback worklet, with the `?debug` toggle standing in for the mic control.
 */
import { expect, type Page, test } from '@playwright/test'
import { barMs } from '../shared/looper'
import { closePeople, expectSynced, openJam, person, startAudio, startJam } from './jam'
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

const singLive = (page: Page) => page.getByRole('switch', { name: 'Sing live (debug)' })

// @scenario collab/live-voice: On the beat, a bar later
test("one person's live voice plays for another exactly one bar after it was sung", async ({
  browser,
  baseURL,
}) => {
  const a = await person(browser, async (c) => {
    await c.grantPermissions(['microphone'])
    await ensureMic(c, `${baseURL}/about`)
  })
  const b = await person(browser)
  const link = await startJam(a.page)
  await openJam(a.page, `${link}?debug`)
  await openJam(b.page, `${link}?debug`)
  for (const p of [a.page, b.page]) {
    await startAudio(p)
    await expectSynced(p)
  }

  await singLive(a.page).check()
  await expect(singLive(a.page)).toBeChecked()
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

  // Turned off: within a bar B hears nothing more of A.
  await singLive(a.page).uncheck()
  await b.page.waitForTimeout(barMs(100) + 500)
  const stopped = (await stats(b.page)).played.length
  await b.page.waitForTimeout(1_000)
  expect((await stats(b.page)).played.length).toBe(stopped)
})

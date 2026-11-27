/**
 * Recording a voice end to end: Chromium's fake microphone (a steady beep) through the voice
 * service, the upload dialog, the Worker and the jam's Durable Object, to another person's pads.
 */
import { expect, type Page, test } from '@playwright/test'
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
import { CLIPS, UPLOAD_HEADERS, UPLOADS } from '../shared/sounds'
import { encodeWav } from '../shared/wav'

test.afterEach(closePeople)

const pad = (page: Page, key: string) =>
  page.getByRole('group', { name: 'Pads' }).getByRole('button', { name: new RegExp(`^${key} `) })

// @scenario audio/voice: Record onto a pad
test('a voice recorded onto Q is an upload of the jam, and plays on Q for everyone', async ({
  browser,
  baseURL,
}) => {
  const a = await person(browser, async (c) => {
    await c.grantPermissions(['microphone'])
    await ensureMic(c, `${baseURL}/about`)
  })
  const b = await person(browser)
  const link = await startJam(a.page)
  await openJam(b.page, link)
  await startAudio(a.page)

  await a.page.getByRole('button', { name: 'Change sounds' }).click()
  await pad(a.page, 'Q').click()
  await a.page.getByRole('option', { name: 'Upload a sound…' }).click()
  const dialog = a.page.getByRole('form', { name: 'Upload a sound' })
  await dialog.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Voice preset: Clean' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible()
  await a.page.waitForTimeout(3_000)
  await dialog.getByRole('button', { name: 'Stop' }).click()

  await expect(dialog.getByRole('button', { name: 'Listen' })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Hey')
  await dialog.getByRole('button', { name: 'Keep' }).click()
  await expect(dialog).toBeHidden()

  const uploads = a.page.getByRole('region', { name: 'Uploaded sounds' })
  await expect(uploads.getByText('Hey', { exact: true })).toBeVisible()
  await expect(uploads.getByText('on Q')).toBeVisible()
  // The other person's Q holds it too.
  await expect(pad(b.page, 'Q')).toHaveAccessibleName(/^Q Hey/)
})

// @scenario audio/voice: Sing a phrase
test('a phrase sung into a take plays from where it was sung, for everyone', async ({
  browser,
  baseURL,
  request,
}) => {
  const a = await person(browser, async (c) => {
    await c.grantPermissions(['microphone'])
    await ensureMic(c, `${baseURL}/about`)
  })
  const b = await person(browser)
  const link = await startJam(a.page)
  await openJam(b.page, link)
  await startAudio(a.page)
  await startAudio(b.page)

  const sing = a.page.getByRole('button', { name: /^Sing/ })
  // Not recording: Sing is disabled.
  await expect(sing).toBeDisabled()

  // 100 BPM: 600 ms a beat. Record, and once the take runs hold M from about beat 4 to beat 6.
  await expectSynced(a.page)
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
  // Stop in the second bar's last beat, so the take is two bars even when the driver is late.
  await a.page.waitForTimeout(7.4 * 600 - (Date.now() - recording))
  await a.page.keyboard.press('Space')
  await expect(recordButton(a.page)).toHaveAttribute('data-phase', 'idle')

  // The track holds the clip as a sound hit near beat 4, and the other person has it too.
  await expect(loops(b.page)).toHaveCount(1, { timeout: 15_000 })
  await expect(loops(b.page).first().locator('.console-clip')).toHaveCount(1)
  const jam = await agentCall(request, 'join', { jam: slugOf(link), kind: 'Claude' })
  const [track] = jam.board.tracks as { bars: number; hits: { soundId?: string; beat: number }[] }[]
  expect(track!.bars).toBe(2)
  const clip = track!.hits.find((h) => h.soundId)
  expect(clip).toBeDefined()
  // Within a beat of where M went down: the fake microphone may take a moment to start the first
  // time, and the driver's key presses land late under load.
  expect(clip!.beat).toBeGreaterThan(3.5)
  expect(clip!.beat).toBeLessThan(5.5)
  const sounds = jam.board.sounds as { id: string; kind: string }[]
  expect(sounds.find((s) => s.id === clip!.soundId)?.kind).toBe('clip')
})

/** Records a take on `page`: Space, then `during` once it runs, then Space to stop. */
async function take(page: Page, during: () => Promise<void>) {
  await expectSynced(page)
  await page.keyboard.press('Space')
  await expect(recordButton(page)).toHaveAttribute('data-phase', 'recording', { timeout: 8_000 })
  await during()
  await page.keyboard.press('Space')
  await expect(recordButton(page)).toHaveAttribute('data-phase', 'idle')
}

/** Holds M on `page` for `ms`, once Sing is enabled. */
async function holdM(page: Page, ms: number) {
  const sing = page.getByRole('button', { name: /^Sing/ })
  await expect(sing).toBeEnabled()
  await page.keyboard.down('m')
  await expect(sing).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(ms)
  await page.keyboard.up('m')
}

// @scenario audio/voice: One clip fails
test("a take whose clip can't be stored keeps its pad hits, and says the clip was lost", async ({
  browser,
  baseURL,
}) => {
  const a = await person(browser, async (c) => {
    await c.grantPermissions(['microphone'])
    await ensureMic(c, `${baseURL}/about`)
  })
  await startJam(a.page)
  await startAudio(a.page)
  // The jam refuses the clip.
  await a.page.route('**/api/jams/*/clips', (route) =>
    route.fulfill({ status: 500, json: { error: 'The upload failed' } }),
  )

  await take(a.page, async () => {
    for (const key of ['1', '2']) {
      await a.page.keyboard.press(key)
      await a.page.waitForTimeout(300)
    }
    await holdM(a.page, 600)
    await a.page.keyboard.press('3')
  })

  await expect(loops(a.page)).toHaveCount(1, { timeout: 10_000 })
  await expect(loops(a.page).first()).toContainText('3 hits')
  await expect(a.page.getByText(/^1 voice clip was lost \(The upload failed\)/)).toBeVisible()
})

// @scenario audio/voice: Full of clips
test('in a jam full of clips Sing is disabled and says so, and pad hits still record', async ({
  browser,
  request,
}) => {
  const a = await person(browser)
  const link = await startJam(a.page)
  // Fill the jam with clips, each from its own address so the clip rate limit doesn't refuse them.
  const second = new Float32Array(UPLOADS.sampleRate).map((_, i) => 0.3 * Math.sin(i / 10))
  const wav = encodeWav(second, UPLOADS.sampleRate)
  for (let n = 0; n < CLIPS.perJam; n++) {
    const res = await request.post(`/api/jams/${slugOf(link)}/clips`, {
      data: Buffer.from(wav),
      headers: {
        'Content-Type': 'audio/wav',
        'CF-Connecting-IP': `10.9.${n >> 8}.${n & 255}`,
        [UPLOAD_HEADERS.name]: `Voice ${n}`,
        [UPLOAD_HEADERS.author]: 'filler',
        [UPLOAD_HEADERS.authorName]: 'Filler',
        [UPLOAD_HEADERS.color]: 'coral',
      },
    })
    expect(res.status()).toBe(201)
  }
  await startAudio(a.page)

  const sing = a.page.getByRole('button', { name: /^Sing/ })
  await take(a.page, async () => {
    await expect(sing).toBeDisabled()
    await expect(a.page.getByText('This jam has no room for more voice clips')).toBeVisible()
    await a.page.keyboard.down('m')
    await a.page.waitForTimeout(300)
    await a.page.keyboard.up('m')
    await a.page.keyboard.press('1')
    await a.page.waitForTimeout(300)
  })
  await expect(loops(a.page)).toHaveCount(1)
  await expect(loops(a.page).first()).toContainText('1 hit')
})

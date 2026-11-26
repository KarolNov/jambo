/**
 * Recording a voice end to end: Chromium's fake microphone (a steady beep) through the voice
 * service, the upload dialog, the Worker and the jam's Durable Object, to another person's pads.
 */
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test'
import { closePeople, openJam, person, startAudio, startJam } from './jam'

test.afterEach(closePeople)

/** The flags that give Chromium its fake microphone, as `playwright.config.ts` launches it. */
const FAKE_MIC = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

/**
 * Whether Chromium's fake microphone answers within a few seconds, asked in a browser of its own:
 * where it hangs, the hung capture would wedge audio capture for the whole browser.
 */
async function fakeMicAnswers(url: string) {
  const browser = await chromium.launch({ args: FAKE_MIC })
  try {
    const context = await browser.newContext({ permissions: ['microphone'] })
    const page = await context.newPage()
    await page.goto(url)
    return await page.evaluate(() =>
      Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }).then(
          (s) => (s.getTracks().forEach((t) => t.stop()), true),
          () => false,
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 3_000)),
      ]),
    )
  } finally {
    await browser.close()
  }
}

/**
 * Where Chromium's fake microphone never answers (on macOS when the process running the browser
 * may not use the microphone, audio capture hangs even for fake devices), a steady tone made in
 * the page stands in for it, so the rest of the path is still walked. The test says so.
 */
async function ensureMic(context: BrowserContext, url: string) {
  if (await fakeMicAnswers(url)) return
  test.info().annotations.push({
    type: 'microphone',
    description: "Chromium's fake microphone didn't answer here; a tone made in the page stood in",
  })
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const out = ctx.createMediaStreamDestination()
      osc.connect(out)
      osc.start()
      return out.stream
    }
  })
}

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

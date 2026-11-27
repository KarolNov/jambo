/**
 * A microphone for e2e tests: Chromium's fake one (a steady beep), or a tone made in the page where
 * that one never answers.
 */
import { type BrowserContext, chromium, test } from '@playwright/test'

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
export async function ensureMic(context: BrowserContext, url: string) {
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

// Live voice spike runner (throwaway). Two tabs in one Chromium, one Cloudflare Realtime app.
//   REALTIME_APP_ID=… REALTIME_APP_TOKEN=… node spike/live-voice/run.mjs <profile> [seconds] [bpm]
// Profiles throttle both tabs with CDP network emulation (it applies to WebRTC: latency,
// throughput, packetLoss, packetReordering).
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const PROFILES = {
  normal: null,
  // Each tab gets this, so the path pays it twice (up from the singer, down to the listener).
  slow: {
    latency: 150,
    downloadThroughput: 750_000 / 8,
    uploadThroughput: 250_000 / 8,
    packetLoss: 2,
    packetQueueLength: 0,
    packetReordering: true,
  },
  // Enough bandwidth, but high delay and heavy loss: isolates loss/latency from starvation.
  lossy: {
    latency: 400,
    downloadThroughput: 1_000_000 / 8,
    uploadThroughput: 1_000_000 / 8,
    packetLoss: 8,
    packetQueueLength: 0,
    packetReordering: true,
  },
  bad: {
    latency: 400,
    downloadThroughput: 400_000 / 8,
    uploadThroughput: 100_000 / 8,
    packetLoss: 8,
    packetQueueLength: 0,
    packetReordering: true,
  },
}

const [profile = 'normal', seconds = '60', bpm = '100', shedBytes = '0'] = process.argv.slice(2)
if (!(profile in PROFILES)) throw new Error(`profile: ${Object.keys(PROFILES).join(', ')}`)
const barMs = (4 * 60_000) / Number(bpm)
const { REALTIME_APP_ID: app, REALTIME_APP_TOKEN: token } = process.env
if (!app || !token) throw new Error('REALTIME_APP_ID and REALTIME_APP_TOKEN required')

async function api(method, path, body) {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${app}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.errorCode)
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`)
  return json
}

const pageJs = readFileSync(new URL('./page.js', import.meta.url), 'utf8')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext()
await context.route('http://localhost:4999/**', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>live spike</title><script>${pageJs}</script>`,
  }),
)

async function tab(name) {
  const page = await context.newPage()
  page.on('console', (m) => console.error(`[${name}] ${m.text()}`))
  page.on('pageerror', (e) => console.error(`[${name}] ${e}`))
  await page.goto(`http://localhost:4999/${name}`)
  if (PROFILES[profile]) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[profile] })
  }
  await page.evaluate(() => window.spike.init())
  const { sessionId } = await api('POST', '/sessions/new')
  const est = await api('POST', `/sessions/${sessionId}/datachannels/establish`, {
    dataChannel: { location: 'remote', dataChannelName: 'server-events' },
  })
  const answer = await page.evaluate((offer) => window.spike.answer(offer), est.sessionDescription)
  await api('PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription: answer })
  await page.evaluate(() => window.spike.connected())
  return { page, sessionId }
}

const t0 = Date.now()
const singer = await tab('singer')
const listener = await tab('listener')
const policy = { ordered: false, maxRetransmits: 0 }
const pub = await api('POST', `/sessions/${singer.sessionId}/datachannels/new`, {
  dataChannels: [{ location: 'local', dataChannelName: 'voice', ...policy }],
})
const sub = await api('POST', `/sessions/${listener.sessionId}/datachannels/new`, {
  dataChannels: [
    { location: 'remote', sessionId: singer.sessionId, dataChannelName: 'voice', ...policy },
  ],
})
const [pubCh, subCh] = await Promise.all([
  singer.page.evaluate((id) => window.spike.openChannel(id), pub.dataChannels[0].id),
  listener.page.evaluate((id) => window.spike.openChannel(id), sub.dataChannels[0].id),
])
const setupMs = Date.now() - t0

await listener.page.evaluate((barMs) => window.spike.listen({ barMs }), barMs)
await new Promise((r) => setTimeout(r, 500))
const sent = await singer.page.evaluate((a) => window.spike.send(a), {
  seconds: Number(seconds),
  shedBytes: Number(shedBytes),
})
await new Promise((r) => setTimeout(r, barMs + 500))
const heard = await listener.page.evaluate((n) => window.spike.results(n), sent.frames)
const stats = {
  singer: await singer.page.evaluate(() => window.spike.stats()),
  listener: await listener.page.evaluate(() => window.spike.stats()),
}

console.log(
  JSON.stringify(
    {
      profile,
      shedBytes: Number(shedBytes),
      conditions: PROFILES[profile],
      seconds: Number(seconds),
      bpm: Number(bpm),
      setupMs,
      channels: { pub: pubCh, sub: subCh },
      sender: sent,
      listener: heard,
      ice: stats,
    },
    null,
    2,
  ),
)
await browser.close()

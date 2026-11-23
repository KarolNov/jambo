/**
 * The scenarios that need two real browsers in one jam, on the real Worker: the jam clock across
 * clients, a knob heard live by everyone, one person's take not touching the other's readout, and
 * a dropped connection merging back.
 */
import { expect, type Page, test, type WebSocketRoute } from '@playwright/test'
import {
  agentAddsLoop,
  clicksHeard,
  closePeople,
  expectLive,
  expectSynced,
  loopNames,
  loops,
  openJam,
  people,
  person,
  recordButton,
  reverbSends,
  startAudio,
  startJam,
  status,
} from './jam'

const readout = (page: Page) => page.locator('.console-readout')

test.afterEach(closePeople)

test.describe('two people in a jam', () => {
  // @scenario audio/looper: Others keep the tempo
  test("one person's take leaves the other's readout on the tempo", async ({ browser }) => {
    const a = await person(browser)
    const b = await person(browser)
    const link = await startJam(a.page)
    await openJam(b.page, link)
    await startAudio(a.page)
    await startAudio(b.page)
    await expectSynced(a.page)

    await a.page.keyboard.press('Space')
    // Through the count-in and into the take, A's readout shows the take; B's keeps the tempo.
    for (const phase of ['count-in', 'recording']) {
      await expect(recordButton(a.page)).toHaveAttribute('data-phase', phase, { timeout: 8_000 })
      await expect(readout(a.page)).toHaveClass(/is-take/)
      await expect(readout(b.page)).not.toHaveClass(/is-take/)
      await expect(readout(b.page).locator('.console-bpm')).toHaveText('100')
      await expect(recordButton(b.page)).toHaveAttribute('data-phase', 'idle')
    }
    await a.page.keyboard.press('Space')
    await expect(readout(a.page)).not.toHaveClass(/is-take/)
  })

  // @scenario audio/looper: Two people's clicks
  test("two people's metronome clicks land within 20 ms of each other", async ({ browser }) => {
    const a = await person(browser)
    const b = await person(browser)
    const link = await startJam(a.page)
    await openJam(b.page, link)
    await startAudio(a.page)
    await startAudio(b.page)
    await expectSynced(a.page)
    await expectSynced(b.page)

    // Both record at once with the metronome on (the default), for a couple of bars.
    await Promise.all([a.page.keyboard.press('Space'), b.page.keyboard.press('Space')])
    for (const p of [a.page, b.page])
      await expect(recordButton(p)).toHaveAttribute('data-phase', 'recording', { timeout: 8_000 })
    await a.page.waitForTimeout(3_000)
    await Promise.all([a.page.keyboard.press('Space'), b.page.keyboard.press('Space')])

    const [heardA, heardB] = await Promise.all([clicksHeard(a.page), clicksHeard(b.page)])
    // Compare the clicks both played: each of B's inside A's span against A's nearest.
    const from = Math.min(...heardA) - 50
    const to = Math.max(...heardA) + 50
    const gaps = heardB
      .filter((t) => t >= from && t <= to)
      .map((t) => Math.min(...heardA.map((u) => Math.abs(u - t))))
    expect(gaps.length, `clicks A ${heardA.length}, B ${heardB.length}`).toBeGreaterThanOrEqual(6)
    test.info().annotations.push({
      type: 'widest click gap',
      description: `${Math.max(...gaps).toFixed(1)} ms over ${gaps.length} clicks`,
    })
    expect(Math.max(...gaps)).toBeLessThan(20)
  })

  // @scenario audio/looper: Turn up the reverb
  // @scenario board/session: Someone turns the reverb
  test('turning Reverb up is heard by both while the knob turns', async ({ browser, request }) => {
    const a = await person(browser)
    const b = await person(browser)
    const link = await startJam(a.page)
    await openJam(b.page, link)
    await startAudio(a.page)
    await startAudio(b.page)
    await agentAddsLoop(request, link, 'Kicks')
    for (const p of [a.page, b.page]) {
      await expect(loopNames(p)).toHaveValue('Kicks')
      await loops(p).getByRole('button', { name: 'Effects' }).click()
    }
    const knobA = a.page.getByRole('slider', { name: 'Reverb of Kicks' })
    const knobB = b.page.getByRole('slider', { name: 'Reverb of Kicks' })
    await expect(knobB).toHaveAttribute('aria-valuenow', '0')
    expect(await reverbSends(b.page)).toEqual([0])
    // A's name as the room seated it (it renames on a clash), from A's own entry in Who's here.
    const nameA = (await people(a.page)
      .and(a.page.locator('[aria-label$=" (you)"]'))
      .getAttribute('aria-label'))!.replace(/ \(you\)$/, '')

    // Drag A's knob up in two moves, holding the button down throughout.
    const box = (await knobA.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await a.page.mouse.move(x, y)
    await a.page.mouse.down()
    await a.page.mouse.move(x, y - 40, { steps: 8 })
    // Mid-turn: B sees who is turning it and its value moving, and both send to the reverb.
    await expect(knobB).toHaveAttribute('aria-description', `${nameA} is turning it`)
    const loudest = async (p: Page) => Math.max(...(await reverbSends(p)))
    await expect.poll(() => loudest(b.page)).toBeGreaterThan(0)
    await expect.poll(() => loudest(a.page)).toBeGreaterThan(0)
    const first = await loudest(b.page)

    await a.page.mouse.move(x, y - 120, { steps: 12 })
    // Still turning: the reverb keeps growing for both.
    await expect.poll(() => loudest(b.page)).toBeGreaterThan(first)
    await expect.poll(() => loudest(a.page)).toBeGreaterThan(first)
    await a.page.mouse.up()

    // Let go: both settle on the same value, and B's knob shows it.
    const settled = Number(await knobA.getAttribute('aria-valuenow'))
    expect(settled).toBeGreaterThan(0.4)
    await expect(knobB).toHaveAttribute('aria-valuenow', String(settled))
    await expect.poll(() => reverbSends(b.page)).toEqual([settled])
    await expect(knobB).not.toHaveAttribute('aria-description', /turning/)
  })

  // @scenario collab/room: Offline for a moment
  // @scenario board/session: Connection drops
  test('edits made apart while one is offline meet when it reconnects', async ({
    browser,
    request,
  }) => {
    // A's board connection runs through a switch the test can open: off, it drops the socket
    // and refuses new ones, as an unreachable server would.
    let online = true
    const sockets = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>()
    const a = await person(browser, (context) =>
      context.routeWebSocket(/\/parties\//, (ws) => {
        if (!online) return void ws.close({ code: 4000, reason: 'offline (test)' })
        sockets.add({ page: ws, server: ws.connectToServer() })
      }),
    )
    const b = await person(browser)
    const link = await startJam(b.page)
    await openJam(a.page, link)
    await agentAddsLoop(request, link, 'Kicks')
    for (const p of [a.page, b.page]) await expect(loopNames(p)).toHaveValue('Kicks')

    online = false
    for (const s of sockets) {
      await s.server.close()
      await s.page.close({ code: 4000, reason: 'offline (test)' })
    }
    sockets.clear()
    await expect(status(a.page)).toHaveText('Reconnecting…')
    await expect(status(a.page)).toHaveAttribute('title', /edits will sync when it is back/)

    // Apart: A renames the loop, B mutes it.
    await loopNames(a.page).fill('Offline kicks')
    await loopNames(a.page).press('Enter')
    await loops(b.page).getByRole('button', { name: 'Mute', exact: true }).click()
    await expect(loopNames(b.page)).toHaveValue('Kicks')
    await expect(loops(a.page).getByRole('button', { name: 'Mute', exact: true })).toBeVisible()

    online = true
    await expectLive(a.page)
    await expect(loopNames(b.page)).toHaveValue('Offline kicks')
    await expect(loops(a.page).getByRole('button', { name: 'Muted', exact: true })).toBeVisible()
    await expect(loopNames(a.page)).toHaveValue('Offline kicks')
  })
})

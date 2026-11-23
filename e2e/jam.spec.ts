/**
 * Happy paths worth walking end to end: each crosses the browser, the Worker and the jam's Durable
 * Object, which the browser tests mock and the Workers tests drive without a page. The Durable
 * Object stays in memory here; reloading a jam from storage is covered in test/worker.test.ts.
 */
import { expect, test } from '@playwright/test'
import {
  agentAddsLoop,
  agentCall,
  closePeople,
  loopNames,
  loops,
  openJam,
  people,
  person,
  recordTake,
  slugOf,
  startAudio,
  startJam,
} from './jam'

test.afterEach(closePeople)

// @scenario collab/jams: Visit the root
test('opening / starts a new jam, and its link opens the same jam again', async ({ browser }) => {
  const { page } = await person(browser)
  const link = await startJam(page)
  expect(slugOf(link)).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{4}$/)
  await expect(page.locator('.console-bpm')).toHaveText('100')
  await expect(page.getByRole('group', { name: 'Pads' }).getByRole('button')).toHaveCount(16)
  await expect(page.getByText('The mixer fills up as you record')).toBeVisible()
  await expect(people(page)).toHaveCount(1)

  // A second visit to / is another jam; the link is the same one.
  const other = await startJam(page)
  expect(other).not.toBe(link)
  await openJam(page, link)
  expect(page.url()).toBe(link)
})

// @scenario board/session: Someone joins
// @scenario collab/room: Two people edit
test('two people see each other, and each one’s edits reach the other', async ({ browser }) => {
  const a = await person(browser)
  const b = await person(browser)
  const link = await startJam(a.page)
  await openJam(b.page, link)
  await expect(people(a.page)).toHaveCount(2)
  await expect(people(b.page)).toHaveCount(2)

  // A sets the tempo; B sees it.
  await a.page.getByRole('button', { name: 'Faster' }).click()
  await expect(b.page.locator('.console-bpm')).toHaveText('101')

  // A records a loop; B gets it within a second.
  await startAudio(a.page)
  await recordTake(a.page, ['1', 'q', '1', 'q'])
  await expect(loops(a.page)).toHaveCount(1)
  await expect(loops(b.page)).toHaveCount(1, { timeout: 1_000 })
  const name = await loopNames(a.page).inputValue()
  await expect(loopNames(b.page)).toHaveValue(name)
  const size = await loops(a.page).locator('.console-channel-size').textContent()
  expect(size).toMatch(/^\d+ bars? · \d+ hits?$/)
  await expect(loops(b.page).locator('.console-channel-size')).toHaveText(size!)
  // With a loop, the tempo is locked for both.
  await expect(b.page.getByRole('button', { name: 'Faster' })).toBeDisabled()

  // At once: B renames it while A mutes it; both edits are kept on both boards.
  await Promise.all([
    loopNames(b.page).fill('Boom tick'),
    loops(a.page).getByRole('button', { name: 'Mute', exact: true }).click(),
  ])
  for (const p of [a.page, b.page]) {
    await expect(loopNames(p)).toHaveValue('Boom tick')
    await expect(loops(p).getByRole('button', { name: 'Muted', exact: true })).toBeVisible()
  }

  // B removes it; it goes for A too.
  await loops(b.page).getByRole('button', { name: 'Remove Boom tick' }).click()
  await expect(loops(a.page)).toHaveCount(0)
  await expect(a.page.getByRole('button', { name: 'Faster' })).toBeEnabled()
})

// @scenario collab/room: Come back later
test('a jam keeps its loops after everyone has left', async ({ browser, request }) => {
  const a = await person(browser)
  const link = await startJam(a.page)
  await startAudio(a.page)
  await recordTake(a.page, ['1', '2'])
  await agentAddsLoop(request, link, 'Kicks')
  await agentAddsLoop(request, link, 'More kicks')
  await expect(loops(a.page)).toHaveCount(3)
  const names = await loopNames(a.page).evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value),
  )
  await a.context.close()

  // Someone else opens the link with nobody connected: the same three loops.
  const b = await person(browser)
  await openJam(b.page, link)
  await expect(loopNames(b.page)).toHaveCount(3)
  expect(
    await loopNames(b.page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
  ).toEqual(names)
})

// @scenario board/session: An agent joins
// @scenario collab/agent: First action
test('an agent acting over MCP shows up for the people in the jam', async ({
  browser,
  request,
}) => {
  const { page } = await person(browser)
  const link = await startJam(page)

  const first = await agentAddsLoop(request, link, 'Agent kicks')
  expect(first.agent.name).toMatch(/^\w+ Claude$/)
  expect(first.agent.agentKey).toEqual(expect.any(String))

  // Everyone's list shows the agent, marked as one; its loop is marked as an agent's.
  const agent = page.getByRole('listitem', { name: `${first.agent.name}, an AI agent` })
  await expect(agent).toBeVisible()
  await expect(agent).toHaveClass(/is-agent/)
  await expect(loopNames(page)).toHaveValue('Agent kicks')
  await expect(loops(page).getByTitle('Added by an AI agent')).toBeVisible()

  // The same key acts as the same agent: still two in the jam, and the loop changes.
  const again = await agentCall(request, 'run', {
    jam: slugOf(link),
    agentKey: first.agent.agentKey,
    summary: 'Quieter kicks',
    ops: [{ op: 'setTrack', id: first.ops[0].id, patch: { gain: 0.5 } }],
  })
  expect(again.agent.id).toBe(first.agent.id)
  await expect(people(page)).toHaveCount(2)
  await expect(page.getByRole('slider', { name: 'Level of Agent kicks' })).toHaveValue('0.5')

  // Leaving takes it out of the list at once.
  await agentCall(request, 'leave', { jam: slugOf(link), agentKey: first.agent.agentKey })
  await expect(agent).toBeHidden()
})

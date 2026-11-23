import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { PAUSED_MESSAGES, UPLOAD_HEADERS, UPLOADS } from '../shared/sounds'
import { encodeWav } from '../shared/wav'
import { connectBoard, until } from './client'
import { budgetFor, monthOf } from '../worker/quota'

let address = 0
const fetchApp = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://jambo.test${path}`, init)

const wav = encodeWav(new Float32Array(UPLOADS.sampleRate / 2).fill(0.25), UPLOADS.sampleRate)

const upload = (slug: string) =>
  fetchApp(`/api/jams/${slug}/sounds`, {
    method: 'POST',
    body: wav,
    headers: {
      'CF-Connecting-IP': `198.51.100.${++address}`,
      [UPLOAD_HEADERS.name]: 'Vox',
      [UPLOAD_HEADERS.author]: 'me',
      [UPLOAD_HEADERS.color]: 'teal',
    },
  })

interface Usage {
  month: string
  bytes: number
  classA: number
  classB: number
}

const stub = () => env.SoundQuota.getByName('global')
const usage = () => runInDurableObject(stub(), (_i, state) => state.storage.get<Usage>('usage'))
const setUsage = (u: Partial<Usage>) =>
  runInDurableObject(stub(), async (_i, state) => {
    const now = (await state.storage.get<Usage>('usage')) ?? {
      month: monthOf(Date.now()),
      bytes: 0,
      classA: 0,
      classB: 0,
    }
    await state.storage.put('usage', { ...now, ...u })
  })
const status = async () => (await fetchApp('/api/sounds/status')).json()

const budget = budgetFor(env.SOUND_BUDGET_PERCENT)

describe('the sound budget', () => {
  it('is 24% of R2’s free tier in production', () => {
    expect(budgetFor('24')).toEqual({ bytes: 2.4e9, classA: 240_000, classB: 2_400_000 })
    expect(budgetFor('0.1')).toEqual({ bytes: 10e6, classA: 1000, classB: 10_000 })
    expect(budgetFor(undefined)).toEqual({ bytes: 0, classA: 0, classB: 0 })
  })

  it('counts stored bytes and writes, and gives bytes back on removal', async () => {
    await setUsage({ bytes: 0, classA: 0, classB: 0 })
    const slug = 'funky-otter-qa01'
    const { id } = (await (await upload(slug)).json()) as { id: string }
    expect(await usage()).toMatchObject({ bytes: wav.length, classA: 1 })
    expect((await fetchApp(`/api/jams/${slug}/sounds/${id}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect(await usage()).toMatchObject({ bytes: 0, classA: 1 })
  })

  // @scenario collab/room: Storage full
  it('pauses uploads when storage is nearly full, and says why', async () => {
    await setUsage({ bytes: budget.bytes - UPLOADS.maxBytes + 1, classA: 0 })
    expect(await status()).toEqual({ uploads: 'storage', reads: 'open' })
    const res = await upload('funky-otter-qa02')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: PAUSED_MESSAGES.storage })
    expect((await env.SOUND_FILES.list({ prefix: 'jams/funky-otter-qa02/' })).objects).toEqual([])
    await setUsage({ bytes: 0 })
    expect(await status()).toEqual({ uploads: 'open', reads: 'open' })
  })

  it('pauses uploads when this month’s writes are nearly spent', async () => {
    await setUsage({ bytes: 0, classA: Math.ceil(budget.classA * 0.9) })
    expect(await status()).toMatchObject({ uploads: 'writes' })
    expect(await (await upload('funky-otter-qa03')).json()).toEqual({
      error: PAUSED_MESSAGES.writes,
    })
  })

  // @scenario collab/room: New month
  it('starts each month with fresh operations but keeps stored bytes', async () => {
    await setUsage({ month: '2000-01', bytes: 1234, classA: budget.classA, classB: budget.classB })
    expect(await status()).toEqual({ uploads: 'open', reads: 'open' })
    await upload('funky-otter-qa04')
    expect(await usage()).toMatchObject({
      month: monthOf(Date.now()),
      bytes: 1234 + wav.length,
      classA: 1,
      classB: 0,
    })
  })

  it('counts reads and refuses new reads once spent', async () => {
    await setUsage({ bytes: 0, classA: 0, classB: 0 })
    const slug = 'funky-otter-qa05'
    const a = (await (await upload(slug)).json()) as { id: string }
    const b = (await (await upload(slug)).json()) as { id: string }
    expect((await fetchApp(`/api/jams/${slug}/sounds/${a.id}`)).status).toBe(200)
    await until(async () => (await usage())?.classB === 1)

    await setUsage({ classB: budget.classB })
    expect(await status()).toMatchObject({ reads: 'reads' })
    const refused = await fetchApp(`/api/jams/${slug}/sounds/${b.id}`)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: PAUSED_MESSAGES.reads })
  })

  it('gets bytes back and counts the list when retention deletes a jam’s audio', async () => {
    await setUsage({ bytes: 0, classA: 0 })
    const slug = 'funky-otter-qa06'
    const client = await connectBoard(slug)
    await upload(slug)
    await upload(slug)
    client.close()
    const board = env.Board.get(env.Board.idFromName(slug))
    await until(async () =>
      runInDurableObject(board, (instance) => [...instance.getConnections()].length === 0),
    )
    expect(await runDurableObjectAlarm(board)).toBe(true)
    expect(await usage()).toMatchObject({ bytes: 0, classA: 3 })
  })
})

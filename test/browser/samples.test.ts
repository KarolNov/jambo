import { afterEach, describe, expect, it, vi } from 'vitest'
import { SampleLoader } from '../../src/audio/samples'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SampleLoader', () => {
  // @scenario audio/sounds: Download refused for now
  it('shows a rate-limited upload as missing, then loads it about a minute on', async () => {
    vi.useFakeTimers()
    let limited = true
    const fetch = vi.fn(async () =>
      limited
        ? new Response('{"error":"Too many downloads, try again in a minute"}', { status: 429 })
        : new Response(new Uint8Array([1, 2, 3])),
    )
    vi.stubGlobal('fetch', fetch)
    const buffer = { duration: 1 } as NonNullable<ReturnType<SampleLoader['get']>>
    const loader = new SampleLoader('funky-otter-k7q2')
    loader.attach({ decodeAudioData: async () => buffer } as unknown as Parameters<
      SampleLoader['attach']
    >[0])

    const id = 'u-abcdefgh2345'
    loader.sync(new Set([id]))
    expect(loader.state(id)).toBe('loading')
    // A few quick retries, then it gives up for now.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(loader.state(id)).toBe('missing')
    const tries = fetch.mock.calls.length
    expect(tries).toBeGreaterThan(1)

    // The limit has passed by the time it tries again.
    limited = false
    await vi.advanceTimersByTimeAsync(50_000)
    expect(fetch.mock.calls.length).toBe(tries)
    expect(loader.state(id)).toBe('missing')
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(loader.state(id)).toBe('ready'))
    expect(loader.get(id)).toBe(buffer)
    loader.dispose()
  })

  it('leaves an upload gone from storage missing, without retrying', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response('Not found', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const loader = new SampleLoader('funky-otter-k7q2')
    loader.sync(new Set(['u-abcdefgh2345']))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(loader.state('u-abcdefgh2345')).toBe('missing')
    expect(fetch).toHaveBeenCalledTimes(1)
    loader.dispose()
  })
})

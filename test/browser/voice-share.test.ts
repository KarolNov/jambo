import { describe, expect, it } from 'vitest'
import { DEFAULT_KEY } from '../../src/audio/voice/dsp/tune'
import type { PresetId } from '../../src/audio/voice/presets'
import { type SharedInput, SharedVoice } from '../../src/audio/voice/shared'

/** A stand-in microphone: records what it was asked to monitor, and whether it closed. */
class FakeInput implements SharedInput {
  monitored: (PresetId | 'off')[] = []
  closed = false
  async monitor(on: boolean, preset: PresetId) {
    this.monitored.push(on ? preset : 'off')
  }
  close() {
    this.closed = true
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

function shared() {
  const opened: FakeInput[] = []
  const mic = new SharedVoice(async () => {
    const input = new FakeInput()
    opened.push(input)
    return input
  })
  return { mic, opened }
}

describe('SharedVoice', () => {
  it('opens one microphone for a take and live voice, and closes it once both let go', async () => {
    const { mic, opened } = shared()
    const live = mic.lease()
    const take = mic.lease()
    expect(await live.voice).toBe(await take.voice)
    expect(opened).toHaveLength(1)

    live.release()
    expect(opened[0]!.closed).toBe(false)
    expect(mic.held).toBe(true)
    take.release()
    await settle()
    expect(opened[0]!.closed).toBe(true)
    expect(mic.held).toBe(false)
  })

  it('opens it again for a lease taken after it closed', async () => {
    const { mic, opened } = shared()
    const a = mic.lease()
    await a.voice
    a.release()
    const b = mic.lease()
    await b.voice
    expect(opened).toHaveLength(2)
    expect(opened[1]!.closed).toBe(false)
  })

  it('releasing twice does not close the microphone under another lease', async () => {
    const { mic, opened } = shared()
    const a = mic.lease()
    const b = mic.lease()
    a.release()
    a.release()
    await b.voice
    await settle()
    expect(opened[0]!.closed).toBe(false)
  })

  it("asks again after a microphone that couldn't be had", async () => {
    let fail = true
    const mic = new SharedVoice(async () => {
      if (fail) throw new Error('blocked')
      return new FakeInput()
    })
    const a = mic.lease()
    await expect(a.voice).rejects.toThrow('blocked')
    a.release()
    fail = false
    await expect(mic.lease().voice).resolves.toBeInstanceOf(FakeInput)
  })

  // @scenario audio/voice: Monitor live
  it("monitors through the latest wish, and falls back to live's when a clip ends", async () => {
    const { mic, opened } = shared()
    const live = mic.lease()
    const take = mic.lease()
    await live.voice
    live.monitor({ preset: 'robot', key: DEFAULT_KEY })
    await settle()
    take.monitor({ preset: 'chipmunk', key: DEFAULT_KEY })
    await settle()
    // The clip ends: back to live's.
    take.monitor(undefined)
    await settle()
    // Live stops: nothing wants it any more.
    live.release()
    await settle()
    expect(opened[0]!.monitored).toEqual(['robot', 'chipmunk', 'robot', 'off'])
  })
})

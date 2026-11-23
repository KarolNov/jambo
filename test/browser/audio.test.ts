import { describe, expect, it } from 'vitest'
import { SOUNDS, UPLOADS } from '../../shared/sounds'
import { renderKit } from '../../src/audio/synth'
import { prepareSample, UploadError } from '../../src/audio/upload'

describe('kit', () => {
  // @scenario audio/sounds: Load the kit
  it('renders every sound of the kit, none of them silent', async () => {
    const kit = await renderKit(UPLOADS.sampleRate)
    expect([...kit.keys()].sort()).toEqual(SOUNDS.map((s) => s.id).sort())
    for (const [id, buffer] of kit) {
      const peak = buffer.getChannelData(0).reduce((m, x) => Math.max(m, Math.abs(x)), 0)
      expect(peak, id).toBeGreaterThan(0.01)
    }
  })
})

describe('preparing an upload', () => {
  // @scenario audio/sounds: Not audio
  it("refuses a file the browser can't decode, saying it isn't a sound file", async () => {
    const notAudio = new Blob([new TextEncoder().encode('just some notes, not a sound')], {
      type: 'audio/mpeg',
    })
    const error = await prepareSample(notAudio).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toBe("That isn't a sound file this browser can read")
  })
})

import { describe, expect, it } from 'vitest'
import { PsolaShifter } from '../src/audio/voice/dsp/psola'
import {
  hzOf,
  midiOf,
  nearestNote,
  pitchDelay,
  scaleNotes,
  VoicePitch,
  type PitchOptions,
} from '../src/audio/voice/dsp/tune'
import { PitchTracker, yin } from '../src/audio/voice/dsp/yin'
import { findClicks, loopbackClick } from '../src/audio/voice/dsp/loopback'

const RATE = 48_000

/** `seconds` of a voice-like tone at `hz`: a sawtooth's first eight harmonics. */
function voice(hz: number | ((t: number) => number), seconds: number, rate = RATE, gain = 0.3) {
  const out = new Float32Array(Math.round(seconds * rate))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const f = typeof hz === 'number' ? hz : hz(i / rate)
    phase += (2 * Math.PI * f) / rate
    let x = 0
    for (let h = 1; h <= 8; h++) x += Math.sin(h * phase) / h
    out[i] = gain * 0.5 * x
  }
  return out
}

/** Deterministic noise. */
function noise(length: number, gain: number, seed = 1) {
  let s = seed
  return Float32Array.from({ length }, () => {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31
    return gain * (s / 2 ** 30 - 1)
  })
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

/** The pitch YIN hears in the middle of `x`, a 4096-sample frame. */
function pitchOf(x: Float32Array, rate = RATE) {
  const mid = Math.floor(x.length / 2)
  return yin(x.subarray(mid - 2048, mid + 2048), rate)?.hz
}

/** Runs `x` through `process` in 128-frame blocks, as the audio thread would. */
function inBlocks(x: Float32Array, process: (i: Float32Array, o: Float32Array) => void) {
  const out = new Float32Array(x.length)
  for (let at = 0; at < x.length; at += 128) {
    process(x.subarray(at, at + 128), out.subarray(at, at + 128))
  }
  return out
}

describe('yin', () => {
  it.each([82, 110, 220, 440, 880])('finds a %d Hz voice within 0.5%%', (hz) => {
    const found = pitchOf(voice(hz, 0.2))!
    expect(Math.abs(found - hz) / hz).toBeLessThan(0.005)
  })

  it('finds a pure sine too', () => {
    const sine = Float32Array.from(
      { length: 4096 },
      (_, i) => 0.3 * Math.sin((2 * Math.PI * 196 * i) / RATE),
    )
    expect(Math.abs(yin(sine, RATE)!.hz - 196)).toBeLessThan(1)
  })

  it('hears no pitch in silence or noise', () => {
    expect(yin(new Float32Array(4096), RATE)).toBeUndefined()
    expect(yin(noise(4096, 0.3), RATE)).toBeUndefined()
  })
})

describe('PitchTracker', () => {
  it('follows a voice fed in blocks, at any context rate, and drops to 0 when it stops', () => {
    for (const rate of [44_100, 48_000, 96_000]) {
      const tracker = new PitchTracker(rate)
      const x = voice(247, 0.3, rate)
      for (let at = 0; at < x.length; at += 128) tracker.push(x.subarray(at, at + 128))
      expect(Math.abs(tracker.hz - 247)).toBeLessThan(2)
      expect(tracker.period).toBeCloseTo(rate / tracker.hz)
      const quiet = new Float32Array(rate / 10)
      for (let at = 0; at < quiet.length; at += 128) tracker.push(quiet.subarray(at, at + 128))
      expect(tracker.hz).toBe(0)
    }
  })
})

describe('scales', () => {
  it('lists a key’s pitch classes', () => {
    expect(scaleNotes({ root: 0, scale: 'major' })).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(scaleNotes({ root: 9, scale: 'minor' })).toEqual([9, 11, 0, 2, 4, 5, 7])
  })

  it('snaps a note between A and B flat to A in A minor', () => {
    const aMinor = scaleNotes({ root: 9, scale: 'minor' })
    expect(nearestNote(midiOf(452), aMinor)).toBe(69)
    // B flat isn't in A minor: even right on it, the nearest is A or B.
    expect([69, 71]).toContain(nearestNote(midiOf(466.16), aMinor))
    // C sharp isn't in C major; just under it is C.
    expect(nearestNote(60.9, scaleNotes({ root: 0, scale: 'major' }))).toBe(60)
  })

  it('snaps to one note in every octave', () => {
    expect(nearestNote(midiOf(130), [9])).toBe(45)
    expect(nearestNote(midiOf(330), [9])).toBe(69)
    expect(hzOf(45)).toBeCloseTo(110)
  })
})

describe('PsolaShifter', () => {
  it('passes a voice through at ratio 1, late by its delay', () => {
    const shifter = new PsolaShifter(RATE)
    const x = voice(200, 0.5)
    const y = inBlocks(x, (i, o) => shifter.process(i, o, RATE / 200, 1))
    expect(Math.abs(pitchOf(y)! - 200)).toBeLessThan(1)
    const settled = y.subarray(shifter.delay + 2000)
    expect(rms(settled)).toBeCloseTo(rms(x.subarray(2000)), 1)
  })

  it.each([
    [0.5, 1],
    [0.75, 1],
    [1.5, 1],
    [1.68, 1.68],
    [0.67, 0.7],
  ])('shifts a voice by %f (formants by %f)', (ratio, formant) => {
    const shifter = new PsolaShifter(RATE)
    const y = inBlocks(voice(180, 0.6), (i, o) => shifter.process(i, o, RATE / 180, ratio, formant))
    expect(Math.abs(pitchOf(y)! / (180 * ratio) - 1)).toBeLessThan(0.01)
    // About the input's level, with no blow-up where grains overlap.
    expect(rms(y.subarray(shifter.delay + 2000))).toBeGreaterThan(0.05)
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(0.6)
  })

  it('lets unvoiced sound through', () => {
    const shifter = new PsolaShifter(RATE)
    const x = noise(RATE / 2, 0.2)
    const y = inBlocks(x, (i, o) => shifter.process(i, o, 0, 1.5))
    expect(rms(y.subarray(shifter.delay + 1000)) / rms(x)).toBeGreaterThan(0.5)
  })
})

describe('VoicePitch', () => {
  const run = (options: PitchOptions, x: Float32Array, rate = RATE) => {
    const node = new VoicePitch(rate, options)
    return inBlocks(x, (i, o) => node.process(i, o))
  }
  const aMinorHard: PitchOptions = {
    mode: { kind: 'tune', notes: scaleNotes({ root: 9, scale: 'minor' }), glide: 0, hold: 0 },
  }

  it('holds an A when hard auto-tune in A minor hears a note between A and B flat', () => {
    const y = run(aMinorHard, voice(452, 0.8))
    expect(Math.abs(pitchOf(y)! - 440)).toBeLessThan(2)
  })

  it('pulls a flat C to C in C major, and leaves an in-tune note alone', () => {
    const cMajor = {
      kind: 'tune',
      notes: scaleNotes({ root: 0, scale: 'major' }),
      glide: 0.06,
      hold: 0.3,
    } as const
    const flat = run({ mode: cMajor }, voice(hzOf(60 - 0.35), 0.8))
    expect(Math.abs(midiOf(pitchOf(flat)!) - 60)).toBeLessThan(0.05)
    const inTune = run({ mode: cMajor }, voice(hzOf(64), 0.8))
    expect(Math.abs(midiOf(pitchOf(inTune)!) - 64)).toBeLessThan(0.05)
  })

  it('glides a natural correction in rather than snapping', () => {
    const natural: PitchOptions = {
      mode: { ...aMinorHard.mode, glide: 0.08, hold: 0.3 } as PitchOptions['mode'],
    }
    const x = voice(452, 0.8)
    const hard = run(aMinorHard, x)
    const soft = run(natural, x)
    // Shortly after the voice starts (past the delay and the tracker's first frame), hard has
    // already moved further from the sung pitch than natural.
    const early = Math.round((pitchDelay(RATE) + 0.06) * RATE)
    const at = (y: Float32Array) => yin(y.subarray(early, early + 2048), RATE)!.hz
    expect(Math.abs(at(hard) - 440)).toBeLessThan(Math.abs(at(soft) - 440))
    expect(Math.abs(pitchOf(soft)! - 440)).toBeLessThan(2)
  })

  it('flattens a sliding voice to one note for Robot', () => {
    const slide = voice((t) => 200 + 30 * t, 1)
    const y = run({ mode: { kind: 'tune', notes: [9], glide: 0, hold: 0 } }, slide)
    expect(Math.abs(pitchOf(y)! - 220)).toBeLessThan(2)
  })

  it('shifts by a fixed interval for Chipmunk and Demon', () => {
    const up = run(
      { mode: { kind: 'shift', semitones: 9, formant: 2 ** (9 / 12) } },
      voice(150, 0.6),
    )
    expect(Math.abs(midiOf(pitchOf(up)!) - midiOf(150) - 9)).toBeLessThan(0.1)
    const down = run({ mode: { kind: 'shift', semitones: -7, formant: 0.7 } }, voice(150, 0.6))
    expect(Math.abs(midiOf(pitchOf(down)!) - midiOf(150) + 7)).toBeLessThan(0.1)
  })

  it('ring-modulates when asked', () => {
    const x = voice(220, 0.5)
    const plain = run({ mode: { kind: 'shift', semitones: 0, formant: 1 } }, x)
    const ringed = run(
      { mode: { kind: 'shift', semitones: 0, formant: 1 }, ring: { hz: 80, mix: 1 } },
      x,
    )
    const from = Math.round(pitchDelay(RATE) * RATE) + 1000
    // A full ring modulation halves the power of what it multiplies.
    expect(rms(ringed.subarray(from)) / rms(plain.subarray(from))).toBeCloseTo(Math.SQRT1_2, 1)
  })
})

describe('loopback latency', () => {
  const rate = 48_000
  /** A recording that started at context frame `start`, hearing each click `delay` frames late. */
  function recording(emits: number[], start: number, delay: number, gain = 0.2) {
    const click = loopbackClick(rate)
    const rec = noise(rate * 3, 0.01, 7)
    for (const e of emits) {
      const at = e + delay - start
      for (let i = 0; i < click.length && at + i < rec.length; i++) rec[at + i]! += gain * click[i]!
    }
    return rec
  }
  const emits = [20_000, 36_000, 52_000, 68_000, 84_000]

  it('measures the round trip from clicks it hears back', () => {
    const delay = Math.round(0.123 * rate)
    const found = findClicks(recording(emits, 5_000, delay), rate, 5_000, emits)
    expect(found).toBeCloseTo(0.123, 3)
  })

  it('hears quiet clicks', () => {
    expect(findClicks(recording(emits, 0, 2_000, 0.03), rate, 0, emits)).toBeCloseTo(
      2_000 / rate,
      3,
    )
  })

  it('gives up when it hears no clicks', () => {
    expect(findClicks(noise(rate * 3, 0.1, 3), rate, 0, emits)).toBeUndefined()
    expect(findClicks(new Float32Array(rate * 3), rate, 0, emits)).toBeUndefined()
  })
})

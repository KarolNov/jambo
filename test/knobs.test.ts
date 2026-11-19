import { describe, expect, it } from 'vitest'
import {
  TONE_HIGH_HZ,
  TONE_LOW_HZ,
  echoSeconds,
  pitchRate,
  reverbImpulse,
  toneFilter,
} from '../src/audio/knobs'

describe('toneFilter', () => {
  it('leaves the sound unchanged at 0', () => {
    expect(toneFilter(0).type).toBe('allpass')
  })

  it('darkens below 0, down to the low cutoff at -1', () => {
    expect(toneFilter(-0.4).type).toBe('lowpass')
    expect(toneFilter(-1).frequency).toBeCloseTo(TONE_LOW_HZ)
  })

  it('thins above 0, up to the high cutoff at +1', () => {
    expect(toneFilter(0.4).type).toBe('highpass')
    expect(toneFilter(1).frequency).toBeCloseTo(TONE_HIGH_HZ)
  })

  it('sweeps further the further it turns', () => {
    expect(toneFilter(-0.6).frequency).toBeLessThan(toneFilter(-0.3).frequency)
    expect(toneFilter(0.6).frequency).toBeGreaterThan(toneFilter(0.3).frequency)
  })

  it('starts fully open on either side of 0', () => {
    expect(toneFilter(-0.01).frequency).toBeGreaterThan(18000)
    expect(toneFilter(0.01).frequency).toBeLessThan(25)
  })
})

describe('pitchRate', () => {
  it('plays at normal speed at 0', () => {
    expect(pitchRate(0)).toBe(1)
  })

  it('doubles an octave up and halves an octave down', () => {
    expect(pitchRate(12)).toBe(2)
    expect(pitchRate(-12)).toBe(0.5)
  })

  it('moves a fifth by about 1.5', () => {
    expect(pitchRate(7)).toBeCloseTo(1.4983, 4)
  })
})

describe('echoSeconds', () => {
  it('repeats on a dotted eighth: 375 ms at 120 BPM', () => {
    expect(echoSeconds(120)).toBeCloseTo(0.375)
  })

  it('follows the tempo', () => {
    expect(echoSeconds(60)).toBeCloseTo(0.75)
  })
})

describe('reverbImpulse', () => {
  it('is two channels of the given length', () => {
    const [l, r] = reverbImpulse(1000, 2.5)
    expect(l.length).toBe(2500)
    expect(r.length).toBe(2500)
  })

  it('differs between ears, for width', () => {
    const [l, r] = reverbImpulse(1000, 1)
    expect(Array.from(l.slice(0, 10))).not.toEqual(Array.from(r.slice(0, 10)))
  })

  it('decays towards silence', () => {
    const [l] = reverbImpulse(1000, 2)
    const peak = (a: Float32Array) => Math.max(...Array.from(a, Math.abs))
    expect(peak(l.slice(-100))).toBeLessThan(peak(l.slice(0, 100)) / 100)
  })

  it('is the same on every client', () => {
    expect(reverbImpulse(1000, 1)).toEqual(reverbImpulse(1000, 1))
  })
})

import { describe, expect, it } from 'vitest'
import {
  DRIVE_HEADROOM,
  TONE_HIGH_HZ,
  TONE_LOW_HZ,
  driveCurve,
  driveGlue,
  echoSeconds,
  FILTER_PEAK_MAX,
  FILTER_Q_MAX,
  FILTER_Q_MIN,
  filterSweep,
  LOFI_RATE_FULL_HZ,
  lofiCrush,
  pitchRate,
  reverbImpulse,
  THROW_FEEDBACK_MAX,
  THROW_FEEDBACK_MIN,
  throwEcho,
  toneFilter,
  widthGains,
} from '../src/audio/knobs'

describe('toneFilter', () => {
  it('is a low-pass at Nyquist at 0, which leaves the sound unchanged', () => {
    expect(toneFilter(0, 24000)).toEqual({ type: 'lowpass', frequency: 24000 })
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

  // @scenario audio/looper: An octave up
  it('doubles an octave up and halves an octave down', () => {
    expect(pitchRate(12)).toBe(2)
    expect(pitchRate(-12)).toBe(0.5)
  })

  it('moves a fifth by about 1.5', () => {
    expect(pitchRate(7)).toBeCloseTo(1.4983, 4)
  })
})

describe('echoSeconds', () => {
  // @scenario audio/looper: Echo in time
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
    // Not the same full-scale first tap in both ears.
    expect(l[0]! + r[0]!).toBeGreaterThan(-1.9)
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

describe('driveCurve', () => {
  const at = (curve: Float32Array, x: number) =>
    curve[Math.round(((x / DRIVE_HEADROOM + 1) / 2) * (curve.length - 1))]!

  it('is a straight line at 0', () => {
    const curve = driveCurve(0)
    for (const x of [-DRIVE_HEADROOM, -1, -0.25, 0, 0.5, 1, DRIVE_HEADROOM])
      expect(at(curve, x)).toBeCloseTo(x, 5)
  })

  it('keeps quiet sounds at their level and rounds loud ones off', () => {
    const curve = driveCurve(1)
    expect(at(curve, 0)).toBe(0)
    // One point of the curve above 0.
    expect(at(curve, 1 / 256)).toBeCloseTo(1 / 256, 5)
    expect(at(curve, 1)).toBeLessThan(0.3)
    expect(at(curve, -1)).toBeCloseTo(-at(curve, 1), 6)
  })
})

describe('driveGlue', () => {
  it('leaves the mix alone at 0 and squeezes it harder as drive rises', () => {
    expect(driveGlue(0)).toEqual({ threshold: -0, ratio: 1, makeup: 1 })
    expect(driveGlue(1)).toEqual({ threshold: -24, ratio: 6, makeup: 3 })
  })
})

describe('widthGains', () => {
  it('leaves the mix at 0, folds it to mono at -1 and doubles the sides at +1', () => {
    expect(widthGains(0)).toEqual({ direct: 1, cross: -0 })
    expect(widthGains(-1)).toEqual({ direct: 0.5, cross: 0.5 })
    expect(widthGains(1)).toEqual({ direct: 1.5, cross: -0.5 })
  })
})

describe('filterSweep', () => {
  const db = (q: number) => 20 * Math.log10(q)

  it('is open at x 0, a low-pass at Nyquist, whatever the resonance', () => {
    expect(filterSweep(0, 0, 24000)).toMatchObject({ type: 'lowpass', frequency: 24000 })
    expect(filterSweep(0, 1, 24000)).toMatchObject({ type: 'lowpass', frequency: 24000 })
  })

  it('sweeps as tone does: a low-pass closing to the left, a high-pass rising to the right', () => {
    for (const x of [-1, -0.5, 0.3, 1])
      expect(filterSweep(x, 0, 24000)).toMatchObject(toneFilter(x, 24000))
  })

  it('raises the resonance from none at y 0 to strong at y 1, in decibels', () => {
    expect(filterSweep(-0.5, 0).q).toBeCloseTo(db(FILTER_Q_MIN))
    expect(filterSweep(-0.5, 1).q).toBeCloseTo(db(FILTER_Q_MAX))
    expect(filterSweep(-0.5, 0.5).q).toBeGreaterThan(filterSweep(-0.5, 0.2).q)
  })

  it('trims its output so the resonant peak stays within FILTER_PEAK_MAX, and not where it is open', () => {
    const peak = (x: number, y: number) => {
      const { q, gain } = filterSweep(x, y)
      return 10 ** (q / 20) * gain
    }
    for (const x of [-1, -0.5, -0.1, 0.1, 0.5, 1])
      for (const y of [0, 0.5, 1]) expect(peak(x, y)).toBeLessThanOrEqual(FILTER_PEAK_MAX + 1e-9)
    expect(filterSweep(0, 1).gain).toBe(1)
    expect(filterSweep(-0.5, 0).gain).toBe(1)
    // Fades in off 0, so a small move doesn't jump the level.
    expect(filterSweep(-0.05, 1).gain).toBeGreaterThan(filterSweep(-0.5, 1).gain)
  })
})

describe('throwEcho', () => {
  it('picks an eighth, a dotted eighth or a quarter note in thirds of x', () => {
    expect([0, 0.2, 0.34, 0.6, 0.67, 1].map((x) => throwEcho(x, 0.5).beats)).toEqual([
      0.5, 0.5, 0.75, 0.75, 1, 1,
    ])
  })

  it('sends nothing at y 0 and all of the mix at y 1, with feedback capped below runaway', () => {
    expect(throwEcho(0, 0)).toMatchObject({ send: 0, feedback: THROW_FEEDBACK_MIN })
    expect(throwEcho(0, 1).send).toBe(1)
    expect(throwEcho(0, 1).feedback).toBeCloseTo(THROW_FEEDBACK_MAX)
    expect(THROW_FEEDBACK_MAX).toBeLessThan(1)
  })
})

describe('lofiCrush', () => {
  it('is untouched at 0/0 and coarse at 1/1', () => {
    expect(lofiCrush(0, 0)).toEqual({ rate: LOFI_RATE_FULL_HZ, bits: 16 })
    expect(lofiCrush(1, 1).rate).toBeCloseTo(4000)
    expect(lofiCrush(1, 1).bits).toBe(4)
  })

  it("starts at the context's own rate, so x 0 passes through on any device", () => {
    expect(lofiCrush(0, 0, 96000).rate).toBe(96000)
    expect(lofiCrush(1, 0, 96000).rate).toBeCloseTo(8000)
  })

  it('lowers the rate exponentially', () => {
    expect(lofiCrush(0.5, 0).rate).toBeCloseTo(Math.sqrt(48000 * 4000))
  })
})

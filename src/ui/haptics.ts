import { WebHaptics } from 'web-haptics'
import { tickGate } from './hapticGate'

/**
 * What the tick is for: `step` is a scrub, knob or fader passing a notch, `detent` a fader landing
 * on its detent, `flip` a switch changing, `tap` a pad pressed.
 */
export type HapticKind = 'step' | 'detent' | 'flip' | 'tap'

/** Each kind's vibration in ms. All short: there is no setting to turn haptics off. */
const DURATION: Record<HapticKind, number> = { step: 4, detent: 12, flip: 10, tap: 8 }

// Steps are throttled (see `MIN_GAP_MS`): a fast drag ticks now and then, not constantly.
const gate = tickGate()

let haptics: WebHaptics | undefined

/**
 * A light haptic tick, on phones that support one (the Vibration API on Android, the hidden
 * switch on iOS Safari), and nothing anywhere else. Call it only from the person's own input
 * handlers, never from playback, a loop's hit, a remote change or an effect. Steps closer together
 * than `MIN_GAP_MS` are dropped.
 *
 * Only on devices with a touchscreen (any coarse pointer, so a phone with a mouse or stylus
 * attached still ticks): a desktop has no motor to drive, and there web-haptics would only mount
 * and click its hidden switch for nothing.
 */
export function haptic(kind: HapticKind): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(any-pointer: coarse)').matches) return
  // Without the Vibration API (iOS), a Switch is a native switch that ticks on its own.
  if (kind === 'flip' && !WebHaptics.isSupported) return
  if (!gate(kind, performance.now())) return
  try {
    haptics ??= new WebHaptics()
    // Full intensity: below 1 the library pulses on and off, which cuts these short ticks in half.
    haptics.trigger(DURATION[kind], { intensity: 1 }).catch(() => {})
  } catch {
    // Best effort: a control works the same without its tick.
  }
}

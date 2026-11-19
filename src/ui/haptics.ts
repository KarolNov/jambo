import { WebHaptics } from 'web-haptics'

/**
 * What the tick is for: `step` is one step of a scrub or knob, `detent` a slider landing on its
 * detent, `flip` a switch changing.
 */
export type HapticKind = 'step' | 'detent' | 'flip'

/** Each kind's vibration in ms. All short: there is no setting to turn haptics off. */
const DURATION: Record<HapticKind, number> = { step: 4, detent: 12, flip: 10 }

let haptics: WebHaptics | undefined

/**
 * A light haptic tick, on phones that support one (the Vibration API on Android, the hidden
 * switch on iOS Safari), and nothing anywhere else. Call it only from the person's own input
 * handlers, never from playback or a remote change.
 *
 * Only on devices with a touchscreen (any coarse pointer, so a phone with a mouse or stylus
 * attached still ticks): a desktop has no motor to drive, and there web-haptics would only mount
 * and click its hidden switch for nothing.
 */
export function haptic(kind: HapticKind): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(any-pointer: coarse)').matches) return
  try {
    haptics ??= new WebHaptics()
    // Full intensity: below 1 the library pulses on and off, which cuts these short ticks in half.
    haptics.trigger(DURATION[kind], { intensity: 1 }).catch(() => {})
  } catch {
    // Best effort: a control works the same without its tick.
  }
}

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
 * Touch-first screens only: elsewhere web-haptics would click a hidden checkbox, and that click
 * bubbles to the document, where it could close an open menu.
 */
export function haptic(kind: HapticKind): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return
  try {
    haptics ??= new WebHaptics()
    haptics.trigger(DURATION[kind]).catch(() => {})
  } catch {
    // Best effort: a control works the same without its tick.
  }
}

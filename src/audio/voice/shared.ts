import type { Key } from './dsp/tune'
import { DEFAULT_PRESET, type PresetId } from './presets'

/** What a lease wants to hear itself through: a preset and key. */
export interface MonitorWish {
  preset: PresetId
  key: Key
}

/** The part of a `VoiceInput` sharing it needs, so tests can stand in for the microphone. */
export interface SharedInput {
  monitor(on: boolean, preset: PresetId, key?: Key): Promise<void>
  close(): void
}

/** One user's hold on the shared microphone. */
export interface VoiceLease<V extends SharedInput> {
  /** The microphone, once open; rejects when it can't be had. */
  readonly voice: Promise<V>
  /**
   * Monitors through `wish` while this lease wants it, or stops wanting it (undefined). The latest
   * wish of any lease still holding one is what the person hears; with none, the monitor is off.
   */
  monitor(wish: MonitorWish | undefined): void
  /** Lets go. The microphone closes once every lease has; a second call does nothing. */
  release(): void
}

/**
 * One microphone shared by everything that sings (a take's clips, live voice), so the browser asks
 * once, singing live and holding M at once use the same input, and its light is on exactly while
 * something holds a lease. A lease taken while the last one's microphone is still open shares it;
 * once all are released it closes, and the next lease opens it again.
 */
export class SharedVoice<V extends SharedInput> {
  private opening?: Promise<V>
  private holders = 0
  /** Each lease's monitor wish, latest last. */
  private wishes = new Map<object, MonitorWish>()

  constructor(private readonly open: () => Promise<V>) {}

  /** Whether the microphone is held (open or opening). */
  get held() {
    return this.holders > 0
  }

  lease(): VoiceLease<V> {
    const opening = (this.opening ??= this.start())
    this.holders++
    const self = {}
    let released = false
    return {
      voice: opening,
      monitor: (wish) => {
        if (released) return
        this.wishes.delete(self)
        if (wish) this.wishes.set(self, wish)
        void this.applyMonitor(opening)
      },
      release: () => {
        if (released) return
        released = true
        const had = this.wishes.delete(self)
        this.holders--
        if (this.holders > 0) {
          if (had) void this.applyMonitor(opening)
          return
        }
        if (this.opening === opening) this.opening = undefined
        opening.then(
          (v) => v.close(),
          () => undefined,
        )
      },
    }
  }

  private start(): Promise<V> {
    const opening = this.open()
    // A microphone that couldn't be had isn't kept: the next lease asks again.
    opening.catch(() => {
      if (this.opening === opening) this.opening = undefined
    })
    return opening
  }

  private async applyMonitor(opening: Promise<V>) {
    let voice: V
    try {
      voice = await opening
    } catch {
      return
    }
    if (this.opening !== opening) return
    const wish = [...this.wishes.values()].at(-1)
    if (wish) await voice.monitor(true, wish.preset, wish.key)
    // Off keeps whatever chain was last built; only its level drops.
    else await voice.monitor(false, DEFAULT_PRESET)
  }
}

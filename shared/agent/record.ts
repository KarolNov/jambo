import { z } from 'zod'
import {
  AssignPad,
  FX_MODE_NAMES,
  FX_MODES,
  type FxMode,
  MASTER_KNOB_NAMES,
  MASTER_KNOBS,
  type MasterKnob,
  newId,
  type Issue,
  type Op,
  RemoveTrack,
  ReplaceSound,
  SetFx,
  SetMaster,
  SetTempo,
  SetTrack,
  SOUND_KNOB_NAMES,
  SOUND_KNOBS,
  type SoundKnob,
  Track,
} from '../board'
import type { ColorName } from '../colors'
import { SOUND_IDS } from '../sounds'
import { AGENT_AUTHOR_PREFIX } from './identity'

/** What each sound knob does, for agents: its range and default come from `SOUND_KNOBS`. */
const KNOB_HELP: Record<SoundKnob, string> = {
  reverb: 'Room: how much goes into the shared reverb',
  echo: 'Echo: how loud the tempo-timed echo is',
  tone: 'Tone: below 0 darker, above 0 thinner',
  pitch: 'Pitch in whole semitones; also changes speed',
  pan: 'Pan: -1 left, 1 right',
}

/** One sentence per knob: what it does, its range and its default. */
export function knobHelp(k: SoundKnob): string {
  const { min, max, default: d } = SOUND_KNOBS[k]
  return `${KNOB_HELP[k]}; ${min} to ${max}, default ${d}`
}

/** What each master knob does, for agents: its range and default come from `MASTER_KNOBS`. */
const MASTER_HELP: Record<MasterKnob, string> = {
  tone: 'Tone of the whole mix: below 0 darker, above 0 thinner',
  drive: 'Drive: saturates the mix and evens its loudness',
  width: 'Width: -1 mono, above 0 wider',
  swing: 'Swing: delays every off-beat 16th, by up to half a 16th at 1',
}

/** One sentence per master knob: what it does, its range and its default. */
export function masterHelp(k: MasterKnob): string {
  const { min, max, default: d } = MASTER_KNOBS[k]
  return `${MASTER_HELP[k]}; ${min} to ${max}, default ${d}`
}

/** What each touchpad mode's X and Y do, for agents: ranges come from `FX_MODES`. */
const FX_HELP: Record<FxMode, string> = {
  filter: 'Filter: x below 0 low-pass closing, above 0 high-pass rising; y resonance',
  throw:
    'Throw (echo of the whole mix): x picks the time (first third 1/8, middle dotted 1/8, last third 1/4); y the send and feedback',
  lofi: 'Lo-fi: x lowers the sample rate, y the bit depth',
  repeat:
    'Repeat (stutters the loops): x picks the slice (four zones: 1/4, 1/8, 1/16, 1/32); y the repeats’ level, 0 off',
}

/** One sentence per touchpad mode: what X and Y do, and their ranges. */
export function fxHelp(m: FxMode): string {
  const { x, y } = FX_MODES[m]
  return `${FX_HELP[m]}; x ${x.min} to ${x.max}, y ${y.min} to ${y.max}`
}

const knobDrafts = Object.fromEntries(
  SOUND_KNOB_NAMES.map((k) => [k, z.number().optional().describe(knobHelp(k))]),
) as Record<SoundKnob, z.ZodOptional<z.ZodNumber>>

const Beat = z.number().describe('When, in beats from the loop start: 0 <= beat < bars * 4')

/**
 * The operations an agent may send in a run, as JSON. Only board changes a person can make; never
 * uploads. `addTrack` gives only what an agent decides; the room fills in the rest. The descriptions
 * reach agents through the `run` tool's schema.
 */
const TrackDraft = z.object({
  name: z.string().describe('Track name'),
  bars: z.number().describe('Loop length in bars'),
  hits: z
    .array(
      z.union(
        [
          z
            .strictObject({ padId: z.string().describe('The pad to hit, like r0c0'), beat: Beat })
            .describe('Plays whatever sound the pad holds'),
          z
            .strictObject({
              soundId: z.string().describe('A listed sound: kit, upload or clip'),
              beat: Beat,
            })
            .describe('Plays that sound whatever the pads hold, unsnapped, cut at the loop end'),
        ],
        { error: 'A hit names a pad (padId) or a sound (soundId), not both' },
      ),
    )
    .describe('The hits of the loop; each names a pad or a sound, not both'),
  gain: z.number().optional().describe('Level 0-1.5, default 1'),
  quantize: z.number().optional().describe('Snap in beats, default 0.25'),
  ...knobDrafts,
})

/** Names a track added earlier in the same run, before it has an id. */
const Ref = z
  .string()
  .regex(/^new:[A-Za-z0-9_-]{1,32}$/, 'A ref is new: and up to 32 letters, digits, _ or -')

export const AgentCall = z.discriminatedUnion('op', [
  SetTempo.describe('Only while the jam has no tracks'),
  AssignPad.describe('Point a pad at a kit sound or an upload, not a clip'),
  ReplaceSound.describe(
    "Move every pad and every track's sound hit on one sound to another; a clip moved off is lost for good",
  ),
  z
    .object({
      op: z.literal('addTrack'),
      ref: Ref.optional().describe('Like new:kicks; later ops in this run can use it as the id'),
      track: TrackDraft,
    })
    .describe('Add a loop; its author and colour are yours'),
  SetTrack.describe(
    `Change a track: name, gain, mute, quantize or a sound knob (${SOUND_KNOB_NAMES.join(', ')})`,
  ),
  RemoveTrack.describe('Remove any track'),
  SetMaster.extend({
    set: z
      .object(
        Object.fromEntries(
          MASTER_KNOB_NAMES.map((k) => [k, z.number().optional().describe(masterHelp(k))]),
        ) as Record<MasterKnob, z.ZodOptional<z.ZodNumber>>,
      )
      .strict()
      .describe('The master knobs to set; the rest keep their value'),
  }).describe('Turn master knobs, heard on the whole mix'),
  SetFx.omit({ startBeat: true })
    .extend({
      mode: z.enum(FX_MODE_NAMES).describe(FX_MODE_NAMES.map(fxHelp).join('. ')),
      x: z.number().describe('X position'),
      y: z.number().describe('Y position'),
    })
    .describe('Put one touchpad mode at x, y; 0/0 is off, so it is also the reset'),
])
export type AgentCall = z.infer<typeof AgentCall>

/** What every `addTrack` ref starts with. */
export const REF_PREFIX = 'new:'

/** One call made ready for `apply`: the operation, or why it was refused before it. */
export type Prepared = { op: Op; id?: string } | { issues: Issue[] }

/** The agent whose identity the room stamps on what it adds. */
export interface AgentStamp {
  /** Public id: authors read `agent:<id>`. */
  id: string
  color: ColorName
}

/**
 * Turns a run's operations into board operations with the agent's identity stamped on: an added
 * track's author, colour, mute, effects and id come from the room, whatever the agent sent. Track
 * refs (`new:kicks`, …) resolve to the ids minted here. One entry per call, in order; a call that
 * isn't a board change an agent may make is refused here and never applied. `listed` says whether
 * the jam lists a sound id (an upload or a clip); a track hitting a sound that is neither listed
 * nor in the kit is refused here too.
 */
export function prepare(
  calls: readonly unknown[],
  agent: AgentStamp,
  mint: () => string = () => newId(),
  listed: (soundId: string) => boolean = () => true,
): Prepared[] {
  // A ref's minted id, or null when its addTrack was refused.
  const refs = new Map<string, string | null>()
  const resolve = (id: string): { id: string } | { issues: Issue[] } => {
    if (!id.startsWith(REF_PREFIX)) return { id }
    const minted = refs.get(id)
    if (minted) return { id: minted }
    const message =
      minted === null ? `Track ${id} wasn't added` : `No track ${id} added earlier in this run`
    return { issues: [{ message, path: ['id'] }] }
  }
  return calls.map((raw): Prepared => {
    const parsed = AgentCall.safeParse(raw)
    if (!parsed.success) {
      const op = (raw as { op?: unknown } | null)?.op
      return {
        issues:
          typeof op === 'string' && !AgentCall.options.some((o) => o.shape.op.value === op)
            ? [{ message: `Agents can't ${op}` }]
            : parsed.error.issues.map((i) => ({ message: i.message, path: i.path })),
      }
    }
    const call = parsed.data
    switch (call.op) {
      case 'addTrack': {
        if (call.ref && refs.has(call.ref))
          return {
            issues: [{ message: `Ref ${call.ref} is already used in this run`, path: ['ref'] }],
          }
        const t = call.track
        const track: Track = {
          name: t.name,
          author: AGENT_AUTHOR_PREFIX + agent.id,
          color: agent.color,
          bars: t.bars,
          hits: t.hits,
          gain: t.gain ?? 1,
          mute: false,
          quantize: t.quantize ?? 0.25,
          effects: [],
          // Only the knobs the agent set: a missing one plays at its default.
          ...Object.fromEntries(
            SOUND_KNOB_NAMES.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]),
          ),
        }
        // Checked here, so a ref never stands for a track that was refused.
        const checked = Track.safeParse(track)
        if (!checked.success) {
          if (call.ref) refs.set(call.ref, null)
          return {
            issues: checked.error.issues.map((i) => ({
              message: i.message,
              path: ['track', ...i.path],
            })),
          }
        }
        const missing = checked.data.hits.findIndex(
          (h) => 'soundId' in h && !SOUND_IDS.has(h.soundId) && !listed(h.soundId),
        )
        if (missing >= 0) {
          if (call.ref) refs.set(call.ref, null)
          const soundId = (checked.data.hits[missing] as { soundId: string }).soundId
          return {
            issues: [
              { message: `No sound ${soundId}`, path: ['track', 'hits', missing, 'soundId'] },
            ],
          }
        }
        const id = mint()
        if (call.ref) refs.set(call.ref, id)
        return { id, op: { op: 'addTrack', id, track } }
      }
      case 'setTrack': {
        const r = resolve(call.id)
        return 'issues' in r ? r : { op: { op: 'setTrack', id: r.id, patch: call.patch } }
      }
      case 'removeTrack': {
        const r = resolve(call.id)
        return 'issues' in r ? r : { op: { op: 'removeTrack', id: r.id } }
      }
      default:
        return { op: call }
    }
  })
}

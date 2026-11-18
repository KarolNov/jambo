import { z } from 'zod'
import { newId, type Issue, type Op, TrackPatch } from '../board'
import type { ColorName } from '../colors'
import { AGENT_AUTHOR_PREFIX } from './identity'

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
      z.object({
        padId: z.string().describe('The pad to hit, like r0c0'),
        beat: z.number().describe('When, in beats from the loop start: 0 <= beat < bars * 4'),
      }),
    )
    .describe('The hits of the loop'),
  gain: z.number().optional().describe('Level 0-1.5, default 1'),
  quantize: z.number().optional().describe('Snap in beats, default 0.25'),
})

/** Names a track added earlier in the same run, before it has an id. */
const Ref = z
  .string()
  .regex(/^new:[A-Za-z0-9_-]{1,32}$/, 'A ref is new: and up to 32 letters, digits, _ or -')

export const AgentCall = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('setTempo'), bpm: z.number() })
    .describe('Only while the jam has no tracks'),
  z
    .object({ op: z.literal('assignPad'), padId: z.string(), soundId: z.string() })
    .describe('Point a pad at a kit sound or an upload'),
  z
    .object({ op: z.literal('replaceSound'), from: z.string(), to: z.string() })
    .describe('Move every pad on one sound to another'),
  z
    .object({
      op: z.literal('addTrack'),
      ref: Ref.optional().describe('Like new:kicks; later ops in this run can use it as the id'),
      track: TrackDraft,
    })
    .describe('Add a loop; its author and colour are yours'),
  z
    .object({ op: z.literal('setTrack'), id: z.string(), patch: TrackPatch })
    .describe('Change a track: name, gain, mute, quantize'),
  z.object({ op: z.literal('removeTrack'), id: z.string() }).describe('Remove any track'),
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
 * isn't a board change an agent may make is refused here and never applied.
 */
export function prepare(
  calls: readonly unknown[],
  agent: AgentStamp,
  mint: () => string = () => newId(),
): Prepared[] {
  const refs = new Map<string, string>()
  const resolve = (id: string) => refs.get(id) ?? id
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
        const id = mint()
        if (call.ref) refs.set(call.ref, id)
        const t = call.track
        return {
          id,
          op: {
            op: 'addTrack',
            id,
            track: {
              name: t.name,
              author: AGENT_AUTHOR_PREFIX + agent.id,
              color: agent.color,
              bars: t.bars,
              hits: t.hits,
              gain: t.gain ?? 1,
              mute: false,
              quantize: t.quantize ?? 0.25,
              effects: [],
            },
          },
        }
      }
      case 'setTrack':
        return { op: { op: 'setTrack', id: resolve(call.id), patch: call.patch } }
      case 'removeTrack':
        return { op: { op: 'removeTrack', id: resolve(call.id) } }
      default:
        return { op: call }
    }
  })
}

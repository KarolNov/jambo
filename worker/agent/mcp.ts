import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'
import { getServerByName } from 'partyserver'
import { z } from 'zod'
import {
  AGENT_AUTHOR_PREFIX,
  AGENT_LIMITS,
  AgentCall,
  DEFAULT_KIND,
  isAgentKey,
  jamSlugOf,
  knobHelp,
  toKind,
} from '../../shared/agent'
import { BPM, LIMITS, QUANTIZE, SOUND_KNOB_NAMES } from '../../shared/board'
import { COLOR_NAMES, toColorName } from '../../shared/colors'
import { UPLOADS } from '../../shared/sounds'
import { toUploadLayout } from '../../shared/wav'
import type { AgentHello } from './roster'

/** Tool calls per minute per address: the AGENT_RUNS limit in `wrangler.jsonc`, keep them equal. */
const AGENT_CALLS_PER_MINUTE = 20

/** The sound knobs, one line each, for the instructions. */
const KNOB_LINES = SOUND_KNOB_NAMES.map((k) => `    ${k}: ${knobHelp(k)}`).join('\n')
const KNOB_FIELDS = SOUND_KNOB_NAMES.map((k) => `${k}?`).join(', ')

/**
 * What the server tells every client, so one without the `/jam` skill still knows how to play:
 * the jam it reads and the operations it sends.
 */
export const INSTRUCTIONS = `jambo is a collaborative music board. Each jam has a link like https://<host>/jam/funky-otter-k7q2; the link (or its slug) is the only key.

Tools: join, run, upload_sound, leave. join, run and upload_sound put you in the jam's "Who's here"; ${AGENT_LIMITS.idleMs / 60_000} minutes without a call takes you out, and leave does it at once. Every tool takes jam (link or slug) and optional agentKey, kind (your type, one word like Claude), name and color (one of ${COLOR_NAMES.join(', ')}). join, run and upload_sound answer agent: { agentKey, id, kind, name, color }; pass agent.agentKey to every later call to stay the same agent, or each call without it joins as a new one. leave answers { jam, left }. A jam seats at most ${AGENT_LIMITS.perJam} agents, ${AGENT_LIMITS.perAddress} from one address; an agent already in it always gets back in with its agentKey. Your name is an adjective and your kind, like "Groovy Claude"; pass the same name and color each time to keep them while free.

join returns board, the jam as it is now:
  bpm: tempo (${BPM.min}-${BPM.max})
  pads: [{ id, key, row, col, soundId }]: the 16 pads; tracks hit pads by id
  sounds: [{ id, name, kind: 'kit' | 'upload', category?, by?, durationMs? }]
  tracks: [{ id, name, author, color, bars, hits: [{ padId, beat }], gain, mute, quantize, startBar?, effects, ${KNOB_FIELDS} }]: a missing knob is at its default
  here: [{ name, kind, color }]: people (kind 'person') and agents
Others change the jam too: call join again to read it fresh.

run takes ops, a JSON array of 1-${AGENT_LIMITS.ops} operations, and summary (1-${AGENT_LIMITS.summaryMax} characters, what the run does). The operations:
  { op: 'setTempo', bpm }: only while the jam has no tracks
  { op: 'assignPad', padId, soundId }: a kit sound id or an upload id
  { op: 'replaceSound', from, to }: moves every pad on one sound to another
  { op: 'addTrack', ref?, track: { name, bars, hits, gain?, quantize?, ${KNOB_FIELDS} } }: bars 1-${LIMITS.bars}; hits [{ padId, beat }] with 0 <= beat < bars * 4 (beats, 4 per bar), 1-${LIMITS.hitsPerTrack} of them; gain 0-1.5 (default 1); quantize one of ${QUANTIZE.join(', ')} beats (default 0.25). The track is yours: author and colour are set for you. ref, like "new:kicks", lets later operations in the same run use the track as an id. A jam holds ${LIMITS.tracks} tracks.
  { op: 'setTrack', id, patch: { name?, gain?, mute?, quantize?, ${KNOB_FIELDS} } }
  The sound knobs, on addTrack and setTrack; each changes how the whole track sounds:
${KNOB_LINES}
  { op: 'removeTrack', id }
Tracks hit pads, so to use a sound, assign it to a pad and hit that pad. The operations apply in order as one change; each gets a result { op, ok, issues?, id? } (id: the new track's), and refused ones change nothing. If any operation doesn't fit the schema, nothing applies. run answers { summary, ops, agent }.

upload_sound takes soundName and wav (base64 of a mono 16-bit PCM ${UPLOADS.sampleRate} Hz WAV, up to ${UPLOADS.maxSeconds} s; other chunks such as LIST are dropped) and answers { id, sound, agent }; a run can then assign id to a pad. leave takes you out of the jam.

Calls are limited to ${AGENT_CALLS_PER_MINUTE} a minute per address.`

/** Every tool's inputs that say which jam and which agent. */
const who = {
  jam: z.string().describe('The jam link, like https://…/jam/funky-otter-k7q2, or its slug'),
  agentKey: z
    .string()
    .optional()
    .describe('The agentKey an earlier call returned; omit on your first call'),
  kind: z.string().optional().describe(`Your kind, one word like Claude (default ${DEFAULT_KIND})`),
  name: z
    .string()
    .optional()
    .describe('Your usual name, an adjective and your kind, like Groovy Claude'),
  color: z
    .string()
    .optional()
    .describe(`Your usual colour, one of ${COLOR_NAMES.join(', ')}`),
}

type Who = z.infer<z.ZodObject<typeof who>>

type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const reply = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
})
const refuse = (message: string, extra: object = {}): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }) }],
  isError: true,
})

class Refusal extends Error {}

/**
 * A one-way tag of the caller's `address` in jam `slug`, so the room can count a caller's agents
 * without holding the address itself.
 */
async function addressTag(address: string, slug: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${slug}\n${address}`),
  )
  return Array.from(new Uint8Array(digest, 0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The jam's slug and the agent's hello, from caller `address`, or a refusal. */
async function resolve(input: Who, address: string): Promise<{ slug: string; hello: AgentHello }> {
  const slug = jamSlugOf(input.jam)
  if (!slug) throw new Refusal(`${JSON.stringify(input.jam)} is not a jam link`)
  if (input.agentKey !== undefined && !isAgentKey(input.agentKey))
    throw new Refusal('That agentKey is not one jambo made: omit it to start fresh')
  let kind: string | undefined
  if (input.kind !== undefined) {
    kind = toKind(input.kind)
    if (!kind) throw new Refusal('kind is one word of 1 to 20 letters or digits, like Claude')
  }
  const color = toColorName(input.color)
  if (input.color !== undefined && !color)
    throw new Refusal(`color is one of ${COLOR_NAMES.join(', ')}`)
  return {
    slug,
    hello: {
      ...(input.agentKey ? { key: input.agentKey } : {}),
      ...(kind ? { kind } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(color ? { color } : {}),
      from: await addressTag(address, slug),
    },
  }
}

/** The runtime's native base64 decoder (`Uint8Array.fromBase64`), which lib.es2023 doesn't type. */
const decodeBase64 = (
  Uint8Array as unknown as {
    fromBase64(text: string, options: { alphabet: 'base64' | 'base64url' }): Uint8Array<ArrayBuffer>
  }
).fromBase64

/** Base64 for the largest upload, before any whitespace. */
const MAX_BASE64 = Math.ceil(UPLOADS.maxBytes / 3) * 4

/** Decodes base64 (standard or URL-safe, whitespace ignored), or says why it can't. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | { error: string } {
  // Room for line breaks, but never decode much more than an upload can be.
  if (text.length > 2 * MAX_BASE64) return { error: 'The file is too big' }
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = decodeBase64(text, { alphabet: /[-_]/.test(text) ? 'base64url' : 'base64' })
  } catch {
    return { error: 'wav is not base64' }
  }
  if (bytes.byteLength > UPLOADS.maxBytes) return { error: 'The file is too big' }
  return bytes
}

/** Builds the MCP server for one request; `address` is the caller's, for the rate limit. */
export function jamboMcpServer(env: Env, address: string) {
  const server = new McpServer(
    { name: 'jambo', version: '1.0.0' },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  )

  /** Wraps a tool: rate limit, then turns refusals into tool errors. */
  const tool =
    <I extends Who>(name: string, fn: (input: I) => Promise<ToolResult>) =>
    async (input: I): Promise<ToolResult> => {
      const { success } = await env.AGENT_RUNS.limit({ key: address })
      if (!success) return refuse('too many requests, try again in a minute')
      try {
        return await fn(input)
      } catch (e) {
        if (e instanceof Refusal) return refuse(e.message)
        console.error('mcp tool failed', { tool: name, jam: input.jam, error: String(e) })
        return refuse('Something went wrong in the jam; try again')
      }
    }

  const room = (slug: string) => getServerByName(env.Board, slug)
  const identity = (a: { key: string; id: string; kind: string; name: string; color: string }) => ({
    agentKey: a.key,
    id: a.id,
    kind: a.kind,
    name: a.name,
    color: a.color,
  })

  server.registerTool(
    'join',
    {
      description:
        "Appear in a jam's Who's here and read the jam as it is now. run joins you too; call join again to read fresh state.",
      inputSchema: z.object(who),
    },
    tool('join', async (input) => {
      const { slug, hello } = await resolve(input, address)
      const joined = await (await room(slug)).agentJoinAndRead(hello)
      if ('error' in joined) return refuse(joined.error)
      return reply({ jam: slug, agent: identity(joined.agent), board: joined.board })
    }),
  )

  server.registerTool(
    'run',
    {
      description:
        'Change the board: a list of operations, applied in order as one change. See the server instructions for each operation and its limits.',
      inputSchema: z.object({
        ...who,
        ops: z
          .array(AgentCall)
          .min(1)
          .max(AGENT_LIMITS.ops)
          .describe(`1-${AGENT_LIMITS.ops} board operations`),
        summary: z.string().describe(`What this run does, 1-${AGENT_LIMITS.summaryMax} characters`),
      }),
    },
    tool('run', async (input) => {
      const { slug, hello } = await resolve(input, address)
      const result = await (await room(slug)).runAgentOps(hello, input.ops, input.summary)
      if ('error' in result) return refuse(result.error)
      return reply({
        summary: result.summary,
        ops: result.ops,
        agent: identity(result.agent),
      })
    }),
  )

  server.registerTool(
    'upload_sound',
    {
      description: `Upload a sound to the jam: a mono 16-bit ${UPLOADS.sampleRate} Hz WAV up to ${UPLOADS.maxSeconds} s, base64. Answers its id, which a run can assign to a pad.`,
      inputSchema: z.object({
        ...who,
        soundName: z.string().describe("The sound's name, up to 40 characters"),
        wav: z.string().describe('The WAV file, base64'),
      }),
    },
    tool('upload_sound', async (input) => {
      const { slug, hello } = await resolve(input, address)
      // Uploads spend the same budget as the browser's: 10 writes a minute per address.
      const { success } = await env.SOUND_WRITES.limit({ key: address })
      if (!success) return refuse('Too many uploads, try again in a minute')
      const decoded = fromBase64(input.wav)
      if ('error' in decoded) return refuse(decoded.error)
      const r = await room(slug)
      const agent = await r.agentJoin(hello)
      if ('error' in agent) return refuse(agent.error)
      const result = await r.uploadSound({
        // Agents' WAVs come from any tool; the room takes only the browser's 44-byte layout.
        wav: toUploadLayout(decoded).buffer,
        name: input.soundName,
        author: AGENT_AUTHOR_PREFIX + agent.id,
        authorName: agent.name,
        color: agent.color,
      })
      if (!result.ok) return refuse(result.error, { agent: identity(agent) })
      return reply({ id: result.id, sound: result.sound, agent: identity(agent) })
    }),
  )

  server.registerTool(
    'leave',
    {
      description: "Leave the jam's Who's here now.",
      inputSchema: z.object(who),
    },
    tool('leave', async (input) => {
      const { slug, hello } = await resolve(input, address)
      if (!hello.key) return refuse('leave needs the agentKey you were given')
      const left = await (await room(slug)).agentLeave(hello.key)
      return reply({ jam: slug, left })
    }),
  )

  return server
}

/** The `/mcp` endpoint: a stateless MCP server, built per request. */
export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const handler = createMcpHandler(() => jamboMcpServer(env, address), {
    route: '/mcp',
  })
  return handler(request, env, ctx)
}

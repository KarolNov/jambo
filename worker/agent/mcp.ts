import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'
import { getServerByName } from 'partyserver'
import { z } from 'zod'
import {
  AGENT_LIMITS,
  AgentCall,
  checkSummary,
  DEFAULT_KIND,
  isAgentKey,
  jamSlugOf,
  toKind,
} from '../../shared/agent'
import { BPM, LIMITS, QUANTIZE } from '../../shared/board'
import { COLOR_NAMES, toColorName } from '../../shared/colors'
import type { AgentHello } from './roster'

/**
 * What the server tells every client, so one without the `/jam` skill still knows how to play:
 * the jam it reads and the operations it sends.
 */
export const INSTRUCTIONS = `jambo is a collaborative music board. Each jam has a link like https://<host>/jam/funky-otter-k7q2; the link (or its slug) is the only key.

Tools: join, run, leave. Any call puts you in the jam's "Who's here"; 5 minutes without a call takes you out, and leave does it at once. Every tool takes jam (link or slug) and optional agentKey, kind (your type, one word like Claude), name and color. Every tool returns agentKey: pass it to every later call to stay the same agent. Your name is an adjective and your kind, like "Groovy Claude"; pass the same name and color each time to keep them while free.

join returns board, the jam as it is now:
  bpm: tempo (${BPM.min}-${BPM.max})
  pads: [{ id, key, row, col, soundId }]: the 16 pads; tracks hit pads by id
  sounds: [{ id, name, kind: 'kit' | 'upload', category?, by?, durationMs? }]
  tracks: [{ id, name, author, color, bars, hits: [{ padId, beat }], gain, mute, quantize, startBar?, effects }]
  here: [{ name, kind, color }]: people (kind 'person') and agents
Others change the jam too: call join again to read it fresh.

run takes ops, a JSON array of 1-${AGENT_LIMITS.ops} operations, and summary (1-${AGENT_LIMITS.summaryMax} characters, what the run does). The operations:
  { op: 'setTempo', bpm }: only while the jam has no tracks
  { op: 'assignPad', padId, soundId }: a kit sound id or an upload id
  { op: 'replaceSound', from, to }: moves every pad on one sound to another
  { op: 'addTrack', ref?, track: { name, bars, hits, gain?, quantize? } }: bars 1-${LIMITS.bars}; hits [{ padId, beat }] with 0 <= beat < bars * 4 (beats, 4 per bar), 1-${LIMITS.hitsPerTrack} of them; gain 0-1.5 (default 1); quantize one of ${QUANTIZE.join(', ')} beats (default 0.25). The track is yours: author and colour are set for you. ref, like "new:kicks", lets later operations in the same run use the track as an id. A jam holds ${LIMITS.tracks} tracks.
  { op: 'setTrack', id, patch: { name?, gain?, mute?, quantize? } }
  { op: 'removeTrack', id }
Tracks hit pads, so to use a sound, assign it to a pad and hit that pad. The operations apply in order as one change; each gets a result { op, ok, issues?, id? } (id: the new track's), and refused ones change nothing. If any operation doesn't fit the schema, nothing applies. run answers { summary, ops, agent }.

Calls are limited to 20 a minute per address.`

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
  color: z.enum(COLOR_NAMES).optional().describe('Your usual colour'),
}

type Who = { jam: string; agentKey?: string; kind?: string; name?: string; color?: string }

type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const reply = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})
const refuse = (message: string, extra: object = {}): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
  isError: true,
})

class Refusal extends Error {}

/** The jam's slug and the agent's hello, or a refusal. */
function resolve(input: Who): { slug: string; hello: AgentHello } {
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
  return {
    slug,
    hello: {
      ...(input.agentKey ? { key: input.agentKey } : {}),
      ...(kind ? { kind } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(color ? { color } : {}),
    },
  }
}

/** Builds the MCP server for one request; `address` is the caller's, for the rate limit. */
export function jamboMcpServer(env: Env, address: string) {
  const server = new McpServer(
    { name: 'jambo', version: '1.0.0' },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  )

  /** Wraps a tool: rate limit, then turns refusals into tool errors. */
  const tool =
    <I extends Who>(fn: (input: I) => Promise<ToolResult>) =>
    async (input: I): Promise<ToolResult> => {
      const { success } = await env.AGENT_RUNS.limit({ key: address })
      if (!success) return refuse('too many requests, try again in a minute')
      try {
        return await fn(input)
      } catch (e) {
        if (e instanceof Refusal) return refuse(e.message)
        throw e
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
    tool(async (input) => {
      const { slug, hello } = resolve(input)
      const r = await room(slug)
      const agent = await r.agentJoin(hello)
      return reply({ jam: slug, agent: identity(agent), board: await r.snapshot() })
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
    tool(async (input) => {
      const { slug, hello } = resolve(input)
      const summary = checkSummary(input.summary)
      if ('error' in summary) return refuse(summary.error)
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
    'leave',
    {
      description: "Leave the jam's Who's here now.",
      inputSchema: z.object(who),
    },
    tool(async (input) => {
      const { slug, hello } = resolve(input)
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

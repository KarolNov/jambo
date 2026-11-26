/** Limits on one agent run and on agent presence. */
export const AGENT_LIMITS = {
  /** Most operations one run may hold. */
  ops: 64,
  summaryMin: 1,
  summaryMax: 140,
  /** Most agents present in one jam at once. */
  perJam: 8,
  /** Most agents present in one jam from one caller address. */
  perAddress: 3,
  /** An agent with no action for this long leaves the jam. */
  idleMs: 5 * 60 * 1000,
  /** How long a jam remembers the name, kind and colour of an agent that left, for its return. */
  awayMs: 7 * 24 * 60 * 60 * 1000,
  /** Most agents that left one jam remembered at once; the longest gone are forgotten first. */
  awayMax: 64,
} as const

/** How `listen` waits for the jam to change. */
export const LISTEN = {
  /** Longest a listen waits for a change, and what it waits when asked for no time. */
  maxWaitMs: 25_000,
  defaultWaitMs: 20_000,
  /** After the first change, how long it keeps collecting, so a knob drag comes as one change. */
  settleMs: 750,
  /** Least time between one agent's answers, so listening in a loop stays cheap. */
  minGapMs: 3_000,
} as const

/** A run's summary trimmed, or an error message when it is missing or too long. */
export function checkSummary(value: unknown): { summary: string } | { error: string } {
  const summary = typeof value === 'string' ? value.trim() : ''
  if (summary.length < AGENT_LIMITS.summaryMin) return { error: 'A run needs a summary' }
  if (summary.length > AGENT_LIMITS.summaryMax)
    return { error: `Keep the summary to ${AGENT_LIMITS.summaryMax} characters` }
  return { summary }
}

/**
 * The Board Durable Object, as each side names it. partyserver routes `/parties/<party>/<room>`
 * to the binding whose name, in kebab case, is `<party>`; the room is the jam's slug.
 *
 * `BOARD_CLASS` must match the binding and class name in `wrangler.jsonc`. The Worker compares it
 * with partyserver's typed `lobby.className`, so a rename there fails the typecheck.
 */
export const BOARD_CLASS = 'Board'

/** What the client passes as `party`: the binding name in kebab case. */
export const BOARD_PARTY = 'board'

/** The path a board connection goes to. */
export const boardPath = (slug: string) => `/parties/${BOARD_PARTY}/${slug}`

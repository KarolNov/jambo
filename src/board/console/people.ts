/** How the console names people, kept apart from React so it can be tested. */
import { isAgentAuthor } from '../../../shared/agent'
import { type ColorName, colorLabel } from '../../../shared/colors'

/** Past this many people the header shows only their dots; names stay in each dot's tooltip. */
export const NAMED_PEOPLE = 3

/** Whether the header names everyone, or shows only dots. */
export const namesPeople = (count: number) => count <= NAMED_PEOPLE

/**
 * A person as the header names them: their name in this jam, marked when it is you. Clients older
 * than names show as their colour.
 */
export const personName = (p: { id: string; name?: string; color: ColorName }, meId: string) =>
  `${p.name ?? colorLabel(p.color)}${p.id === meId ? ' (you)' : ''}`

/** Who uploaded a sound, for its dot's tooltip. Sounds uploaded before names show the colour. */
export const uploadedBy = (
  sound: { author: string; authorName?: string; color: ColorName },
  meId: string,
) =>
  sound.author === meId
    ? 'Uploaded by you'
    : `Uploaded by ${sound.authorName ?? colorLabel(sound.color)}`

/** Whether a loop or sound was added by an AI agent, so the UI marks it. */
export const byAgent = (thing: { author: string }) => isAgentAuthor(thing.author)

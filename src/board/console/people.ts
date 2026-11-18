/** How the console names people, kept apart from React so it can be tested. */
import { type ColorName, colorLabel } from '../../../shared/colors'

/** Past this many people the header shows only their dots; names stay in each dot's tooltip. */
export const NAMED_PEOPLE = 3

/** Whether the header names everyone, or shows only dots. */
export const namesPeople = (count: number) => count <= NAMED_PEOPLE

/** A person as the header names them: their colour, marked when it is you. */
export const personName = (p: { id: string; color: ColorName }, meId: string) =>
  `${colorLabel(p.color)}${p.id === meId ? ' (you)' : ''}`

/** Who uploaded a sound, for its dot's tooltip. */
export const uploadedBy = (sound: { author: string; color: ColorName }, meId: string) =>
  sound.author === meId ? 'Uploaded by you' : `Uploaded by ${colorLabel(sound.color)}`

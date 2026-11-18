/**
 * People's names: a fun adjective and an animal, like "Groovy Otter". Each browser keeps one as its
 * usual name; in a jam the room makes sure nobody else there has it. Animals only, so a name can one
 * day come with an animal avatar in the person's colour.
 */
import { ADJECTIVES } from './words'

export const ANIMALS = [
  'otter',
  'panda',
  'falcon',
  'lemur',
  'walrus',
  'badger',
  'gecko',
  'heron',
  'koala',
  'llama',
  'moose',
  'narwhal',
  'octopus',
  'parrot',
  'quokka',
  'raccoon',
  'salmon',
  'tapir',
  'toucan',
  'turtle',
  'whale',
  'yak',
  'zebra',
  'beaver',
  'axolotl',
  'bison',
  'capybara',
  'dolphin',
  'ferret',
  'flamingo',
  'fox',
  'giraffe',
  'hedgehog',
  'ibis',
  'jaguar',
  'kiwi',
  'lynx',
  'manatee',
  'meerkat',
  'ocelot',
  'owl',
  'pangolin',
  'penguin',
  'puffin',
  'seal',
  'sloth',
  'squid',
  'wombat',
] as const

/** Longest a name may be: the longest adjective and animal, with room to spare. */
export const NAME_MAX = 40

const title = (word: string) => word[0]!.toUpperCase() + word.slice(1)

/** A random name, from `random` (a float in [0, 1)). */
export function randomName(random: () => number = Math.random): string {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!
  const animal = ANIMALS[Math.floor(random() * ANIMALS.length)]!
  return `${title(adjective)} ${title(animal)}`
}

/** A name as stored and sent: trimmed, 1 to `NAME_MAX` characters; undefined otherwise. */
export function toName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  return name.length > 0 && name.length <= NAME_MAX ? name : undefined
}

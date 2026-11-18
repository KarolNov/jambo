/** Keyboard movement through a list of options, some disabled. Pure, so it can be tested. */

export interface NavOption {
  disabled?: boolean
}

/** The next enabled option after `from` in direction `dir`, wrapping; `from` if there is none. */
export function stepIndex(options: readonly NavOption[], from: number, dir: 1 | -1): number {
  const n = options.length
  for (let k = 1, i = from; k <= n; k++) {
    i = (((i + dir) % n) + n) % n
    if (!options[i]!.disabled) return i
  }
  return from
}

/** Where a list opens: on the current value if it can be picked, else the first enabled option. */
export function initialIndex(options: readonly (NavOption & { value: string })[], value: string) {
  const i = options.findIndex((o) => o.value === value)
  return i >= 0 && !options[i]!.disabled ? i : stepIndex(options, -1, 1)
}

/**
 * What a key does in an open list: move to another option (its index), pick the active one, or
 * nothing (undefined). ↑ ↓ wrap, Home and End go to the first and last enabled option.
 */
export function navKey(
  key: string,
  options: readonly NavOption[],
  active: number,
): number | 'pick' | undefined {
  switch (key) {
    case 'ArrowDown':
      return stepIndex(options, active, 1)
    case 'ArrowUp':
      return stepIndex(options, active, -1)
    case 'Home':
      return stepIndex(options, -1, 1)
    case 'End':
      return stepIndex(options, options.length, -1)
    case 'Enter':
    case ' ':
      return options[active] && !options[active].disabled ? 'pick' : undefined
    default:
      return undefined
  }
}

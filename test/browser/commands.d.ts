// The mouse commands in vitest.commands.ts, as tests call them through `commands`.
import 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Presses the mouse on the middle of what `selector` matches; returns where, in page pixels. */
    mouseDown: (selector: string) => Promise<{ x: number; y: number }>
    /** Moves the mouse to (x, y) in page pixels, in `steps` moves. */
    mouseMove: (x: number, y: number, steps?: number) => Promise<void>
    mouseUp: () => Promise<void>
  }
}

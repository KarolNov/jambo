# jambo design system

Rules for UI work in jambo. The same controls are live, with their states, at `/ds` (`src/ds/`);
run `pnpm dev` and open it to see what this page describes.

## Where things live

- `src/theme/`: the two themes. `palette.ts` holds the colour tokens and collaborator swatches,
  `theme.ts` publishes them on `<html>` (`useThemedPage()`), `theme.css` defines depth and focus.
- `src/ui/`: the shared controls, exported from `src/ui/index.ts`. Import them from there, never
  from the files inside.
- `src/ds/`: the `/ds` showcase. `catalogue.tsx` holds one entry per `src/ui` component.
- Feature CSS (`src/board/console/*.css`) lays controls out; it doesn't restyle them.

## Tokens

Use the CSS variables, never hex values. A token exists in both themes; dark has its own values,
never an inverted light one.

| Variable                   | For                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `--bg`                     | The one surface everything is moulded from.                                               |
| `--hi`, `--lo`             | The lit and shaded sides of a shadow. Use via depth tokens.                               |
| `--text`, `--muted`        | Text, and secondary text (captions, hints, units).                                        |
| `--accent`                 | Record and destructive actions, errors.                                                   |
| `--accent-2`               | Selection, "open", hover, the default focus and value tint. A jam sets it to your colour. |
| `--flat`, `--line`         | High-contrast plates that carry data (hit patterns, grids).                               |
| `--ok`, `--info`           | Status lights only: green for live, blue for trying again.                                |
| `--focus`                  | Keyboard focus rings. A jam sets it to your colour.                                       |
| `--cap-top` … `--cap-drop` | The fader cap's and rocker's shading. Controls only.                                      |

Text keeps 4.5:1 against `--bg` (7:1 for body text); collaborator colours keep 3:1.
`test/theme.test.ts` checks both.

## Depth

One surface lit from the top left. Depth says what something is:

- **Raised** (`--raise`, `--raise-sm`, `--raise-lg`): you can press it. Buttons, pads, cards.
- **Inset** (`--inset`, `--inset-sm`): it holds a value, or it is pressed in. Fields, wells,
  a button while held or `aria-pressed`.
- **Float** (`--float`): it is over the page. Popovers only.

Don't mix borders into this: separate things with depth and space, not lines.

## Focus

Focus shows inside a control as a 2px rim in `--focus`: `inset 0 0 0 2px var(--focus)` added to the
control's own shadow. No outer outlines. Every control must show it on `:focus-visible`.

## Colour

- Collaborator colours are names (`ColorName`), painted per theme with `useSwatch()` from
  `src/board/colors.ts` (or `SWATCHES` in `src/theme/palette.ts`). Never store or hard-code a hex.
- A control that belongs to something coloured takes the colour as a prop (`color` on `Range` and
  `Knob`), which sets `--ui-c`. Without one it uses `--accent-2`. `Pad` lights in `--glow`.
- Someone else moving a shared control shows in their colour and locks it: pass `heldBy` (a
  `Holder`: their name and swatch) to `Range`, `Knob` or `XYPad`, which lights it in that colour
  in place of its own (the fader's LEDs and cap line, the knob's arc and index line, the pad's puck
  and lines; no outline), keeps the
  bubble up with their name, and ignores your drags and keys until they let go (it keeps focus).
  If it arrives mid-drag (you lost a simultaneous grab), your drag ends where it is. Report your
  own drags with `onDragChange` so others see yours; `useHolders` decides who holds what.
- Red means record or destroy (`--accent`, `tone="danger"`). Don't use it for anything else.

## Motion and haptics

- Every transition has a `prefers-reduced-motion: reduce` fallback with no easing or spring.
- Haptics come only from `haptic(kind)` in `src/ui/haptics.ts`, and only from the person's own
  input handlers. Never from playback, a loop's hits (a pad's `flash`), remote changes or effects.
- Kinds: `step` as a drag passes a notch (a light of a knob's ring or the fader's strip, or a
  scrub's step), `detent` as a fader lands on its detent, `flip` as a switch changes, `tap` as a
  pad is pressed. Steps are throttled (`MIN_GAP_MS` in `src/ui/hapticGate.ts`), so a fast drag
  ticks now and then instead of buzzing. Keys never tick.
- iOS Safari gives scripts no haptics (iOS 26.5 closed the hidden-switch trick), so only a native
  switch under the finger ticks there (`Switch`). Every other kind ticks on Android only.
- A drag previews locally and applies once, on release (`useScrub`). Don't send a board operation
  per pixel.

## Components

Every component exported from `src/ui/index.ts` has a section here and an entry in
`src/ds/catalogue.tsx`. `test/ds.test.ts` fails when one is missing.

### Button

A soft raised button (`ButtonProps`: `tone` and `size` on top of a native button's props). It is
pressed in while held or while `aria-pressed` is true.

- Use for any action with a text label. `tone="primary"` for the one main action in view,
  `danger` for record and destructive actions, `quiet` for a low-key action such as Cancel.
- Use `aria-pressed` for toggles that read as a pressed key (Mute, Solo).
- Not for on/off settings (use `Switch`) or icon-only actions (use `IconButton`). Never two
  primaries in one group.

### IconButton

A round soft button with only an icon. Its `label` is required: it names the button for screen
readers and is its tooltip.

- Use for steppers, close and compact actions whose icon is unmistakable.
- Not for actions people would have to guess from the icon: use `Button` with text.

### Switch

An on/off switch (`SwitchProps`) in two variants. A native `<input type="checkbox" switch>`
underneath, so iOS gives its own tick; elsewhere it calls `haptic('flip')`.

- `variant="rocker"` (default): an I/O rocker that tips toward the side that is on, with the I
  lit when on. Use for a setting of the music that takes effect at once (the metronome).
- `variant="slide"`: a knob that springs along an inset track onto the side that is on,
  stretching while held. Use for a preference of the app rather than the music. Without marks,
  the track lights behind the knob, filling the space it leaves, like a physical switch. With
  marks, the knob is a readout that flips from `off` to `on`, like an LED display:
  `ThemeToggle` in `src/theme` shows a sun, then a moon.
- `off` and `on` default to the rocker's O and I, and to nothing on the slide. Without a
  visible label, give it an `aria-label`.
- Not for one-off actions (`Button`) or choices between named options (`Select`). Don't put
  both variants side by side in one group.

### Range

A mixer fader: a solid cap in a thin slot, an LED strip lit to the value in `color`, optional
`marks` and a `detent` that drags stick to. The value shows in a bubble while dragged
(`format` decides how it reads). It stays a native range input.

On Android phones a drag ticks lightly as it passes each light of the LED strip and firmer as it lands
on the detent.

- Use for a continuous level adjusted by feel, such as a loop's volume. Give it marks where
  people aim and a detent where they return (unity).
- Not for exact numbers (`ScrubField`) or secondary parameters in tight space (`Knob`).

### Knob

A rotary control (`KnobProps`) on `useScrub`: drag up or right to turn it up, Shift for ten
steps, Escape to put it back, double-click for `defaultValue`. Arrows, Page Up/Down, Home and End
turn it. Screen readers hear a slider. Its size is `--knob` (48px).

By default it applies once, on release. With `live` it applies as it turns, at most once a frame
(as `Range` does), and Escape applies the start value again, so everyone hears the change while
it happens and a cancel puts it back for everyone.

On Android phones a turn ticks lightly as it passes each light of the ring (`segments`, else 24), or each
step when there are fewer steps than that. Keys and the double-click reset don't tick.

- Use for a secondary continuous parameter where a fader would take too much room, such as a
  loop's sound knobs in the mixer's Effects strip (live, in the loop's colour).
- Give it `segments` (the mixer uses 16) beside faders: its ring splits into that many lights like
  the fader's LED strip, lit a whole light at a time. Pick an even count so a centred knob lights
  exactly half. Leave it out elsewhere for a continuous ring.
- Make it `live` when others hear or see the value as it changes; leave it on release when each
  change is costly or only the end value matters.
- Not for the main level of something (`Range`) or typed values (`ScrubField`).

### XYPad

A square that sets two values at once (`XYPadProps`, each axis an `XYAxis`: its slider's
`label`, range, `step` and `format`). Press anywhere and drag: the puck jumps there and follows,
with a line through it on each axis in `color`. A drag previews locally and applies once on
release; with `live` it applies as it moves, at most once a frame, as a live `Knob` does. It
stays where it is let go. Escape mid-drag puts it back where the drag started (and applies that
again when live). ← → move X a step and ↑ ↓ move Y, whichever axis has focus (held together, one of each moves it
diagonally; a move of the other axis is announced), Shift for ten;
Page Up/Down, Home and End move the focused axis. `home` marks a position (where it is off).
A move it didn't follow a drag to (a key, a peer's drag, a reset) glides there, so a peer's
moves read smoothly. While someone else holds it, its puck and lines turn their colour, with no outline. Screen readers hear a group named `label` with two sliders. Size it with `--xy` (default 200px,
never wider than its container); leave room above for the bubble.

- Use for two parameters played together by feel, such as a touchpad mode's X and Y. Make it
  `live` when everyone hears it move.
- Not for one value (`Knob`, `Range`) or exact numbers (`ScrubField`).

### ScrubField

A number field whose label scrubs it (`ScrubFieldProps`), on `useScrub`: drag the label sideways,
Shift for ten steps, applied once on release, Escape to cancel. It can also be typed in (Enter or
blur applies, Escape cancels) and stepped with ↑ ↓. Typed values reach `onChange` as typed, so
the owner clamps them and says why. `start` and `end` hold steppers. Disabled, the label doesn't
scrub.

- Use for an exact number people also sweep, such as the tempo.
- Not for levels adjusted by feel (`Range`).

### Select

A soft button showing the current option that opens an `OptionList` in a `Popover`. Options
come as `Group`s of `Option`s.

- Use to pick one of several named options.
- Not for on/off (`Switch`). Never a native `<select>`: it ignores the theme.

### Popover

Floats its children beside an anchor element, below it or above when there is more room, and
closes on Escape or a press outside. Rendered into `<body>`, where the theme's tokens still apply.

- Use for a menu or short panel tied to the control that opened it.
- Not for anything people must finish before going on (that is a dialog). Don't nest popovers.

### OptionList

A list of `Option`s in `Group`s to pick one from, with notes, dots and disabled options, driven
by ↑ ↓ Home End and Enter or Space. It takes focus when it mounts.

- Use inside a `Popover` when what opens it isn't a `Select` button (a pad, say).
- Not in the page flow: it grabs focus as it mounts.

### Pad

A pad's face (`PadProps`): a soft rubber square with its key moulded into the middle, and its
sound's name printed on the console under it (up to two lines, then an ellipsis), optionally with
a `dot` and a sample `status`, plus the `editing` badge. The key and name are the pad's accessible
name and the name its tooltip. `ref` and the button props go on the rubber pad; `style` lays out the slot that holds the
pad and its name, such as its grid cell. `lit="pressed"` pushes it in with a ring in `tint` (else
`--glow`, then `--accent-2`); `lit="glow"` lights it from inside. Otherwise presentational, except
that a primary press with a finger or mouse taps on Android phones (`haptic('tap')`). `lit` and
the console's flashes for loop hits never tap.

- Use for a pad that plays a sound. The owner decides what a press does.
- For live hits, set the `pressed` and `glow` classes and `--glow` on the element directly, as
  `src/board/console/Pads.tsx` does: hits come too fast for React state.
- Not as a general-purpose button: use `Button`.

### Tabs

Folder tabs over one panel (`TabsProps`, each tab a `Tab`: `id`, `label`, `content`, optional
`disabled`). The panel is a raised card and the selected tab is part of it, labelled in `--ui-c`
(else `--accent-2`); the other tabs sit behind the card. Selecting swaps them at once: only the
label's colour eases. Tabs that don't fit go behind a "+N" tab that opens a menu of them
(`src/ui/tabFit.ts`); the selected tab always shows, in place of the last one that fits. ← →
move through every tab, shown or not, and select as they go, Home and End jump to the ends, and
Tab moves on to "+N", then into the panel (its first control, or the panel itself when it has
none). Pass `value` and `onChange` to control it, or
`defaultValue` to let it keep the selection. A tab's `dot` puts a dot in `--ui-c` after its label
to say its content is on (a touchpad mode away from 0/0): give it what screen readers hear ("on"),
or `''` to keep its room without showing it, so tabs don't change width as dots come and go.

- Use for a few parallel versions of the same content where people want one at a time, such as
  the setup steps per AI app on `/about`. Keep labels short, so more of them fit before "+N".
- Not for choosing a value that changes the music or the jam (`Select`, `Switch`), for content
  people compare or read in order (show it all), or inside another `Tabs`.

## Don'ts

- Don't restyle a `src/ui` control from feature CSS. Change it in `src/ui/ui.css` (and check `/ds`)
  or add a prop.
- Don't add colours. Use the tokens and swatches; a new token goes into `palette.ts` for both
  themes, with its contrast tested.
- Don't use native `<select>`, outer focus outlines, borders for separation, or drop shadows
  outside `--float`.
- Don't trigger haptics from anything but the person's own input.

## Adding a component

1. Build it in `src/ui/`, styled in `ui.css` under `:root[data-theme]`, and export it (and its
   props type) from `src/ui/index.ts`.
2. Add its entry to `src/ds/catalogue.tsx`: a demo per state, and when and when not to use it.
3. Add its section under Components here, naming its exported types.
4. `pnpm test` checks steps 2 and 3.

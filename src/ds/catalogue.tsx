/**
 * The /ds catalogue: one entry per component exported from src/ui/index.ts, with demos of its
 * states and the rules for using it. test/ds.test.ts fails when an export has no entry here (it
 * reads each `name: '…'`), so add one with every new export. Demos take the page's collaborator
 * colour from the CSS variables Showcase sets (`--ui-c`, `--glow`, `--focus`).
 */
import { type ReactNode, useRef, useState } from 'react'
import {
  Button,
  type Group,
  IconButton,
  Knob,
  OptionList,
  Pad,
  Popover,
  Range,
  ScrubField,
  Select,
  Switch,
} from '../ui'
import { ThemeToggle } from '../theme/ThemeToggle'

export interface Entry {
  /** The export's name in src/ui/index.ts. */
  name: string
  /** What it is, in a sentence. */
  summary: string
  /** Each state worth seeing, as a live demo. Hover, focus and press work on every demo too. */
  states: { label: string; demo: ReactNode }[]
  /** When to reach for it. */
  use: string[]
  /** When not to, and what to use instead. */
  avoid: string[]
}

const SOUNDS: Group[] = [
  {
    label: 'Drums',
    options: [
      { value: 'kick', label: 'Kick' },
      { value: 'snare', label: 'Snare' },
      { value: 'hat', label: 'Closed hat' },
    ],
  },
  {
    label: 'Uploads',
    options: [
      {
        value: 'yeah',
        label: 'yeah.wav',
        note: '0.8 s',
        dot: { color: 'var(--ui-c)', title: 'Uploaded by you' },
      },
    ],
  },
  { options: [{ value: 'upload', label: 'Uploads paused', disabled: true }] },
]

const percent = (v: number) => `${Math.round(v * 100)}%`
const level = (v: number) => (v === 1 ? 'Unity' : percent(v))

function SwitchDemo({
  on = false,
  disabled,
  variant,
}: {
  on?: boolean
  disabled?: boolean
  variant?: 'rocker' | 'slide'
}) {
  const [checked, setChecked] = useState(on)
  return (
    <Switch checked={checked} onChange={setChecked} disabled={disabled} variant={variant}>
      Metronome
    </Switch>
  )
}

function RangeDemo({
  start,
  disabled,
  marks,
}: {
  start: number
  disabled?: boolean
  marks?: boolean
}) {
  const [value, setValue] = useState(start)
  return (
    <Range
      label="Level"
      value={value}
      onChange={setValue}
      keyStep={0.05}
      max={1.5}
      marks={marks ? [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5] : undefined}
      detent={marks ? 1 : undefined}
      format={level}
      disabled={disabled}
    />
  )
}

function KnobDemo({ start, disabled }: { start: number; disabled?: boolean }) {
  const [value, setValue] = useState(start)
  return (
    <Knob
      label="Drive"
      value={value}
      onChange={setValue}
      defaultValue={0.5}
      format={percent}
      disabled={disabled}
    />
  )
}

function ScrubDemo({ disabled, steppers }: { disabled?: boolean; steppers?: boolean }) {
  const [bpm, setBpm] = useState(100)
  const set = (v: number) => setBpm(Math.min(240, Math.max(40, Math.round(v))))
  return (
    <ScrubField
      label="BPM"
      aria-label="Tempo in BPM"
      value={bpm}
      onChange={set}
      min={40}
      max={240}
      maxLength={3}
      disabled={disabled}
      start={
        steppers && (
          <IconButton label="Slower" disabled={disabled} onClick={() => set(bpm - 1)}>
            −
          </IconButton>
        )
      }
      end={
        steppers && (
          <IconButton label="Faster" disabled={disabled} onClick={() => set(bpm + 1)}>
            +
          </IconButton>
        )
      }
    />
  )
}

function SelectDemo() {
  const [value, setValue] = useState('snare')
  return <Select label="Sound" value={value} groups={SOUNDS} onChange={setValue} />
}

function PopoverDemo() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <span ref={anchor} className="ds-anchor">
      <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Share
      </Button>
      {open && anchor.current && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)}>
          <p className="ds-popover-text">Anyone with the link can join this jam.</p>
        </Popover>
      )}
    </span>
  )
}

function OptionListDemo() {
  const anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('kick')
  return (
    <div ref={anchor} className="ds-anchor">
      <Pad
        keyLabel="q"
        name={SOUNDS.flatMap((g) => g.options).find((o) => o.value === value)?.label ?? ''}
        editing
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && anchor.current && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)}>
          <OptionList
            groups={SOUNDS}
            value={value}
            label="Sound for pad Q"
            onSelect={(v) => {
              setValue(v)
              setOpen(false)
            }}
          />
        </Popover>
      )}
    </div>
  )
}

export const CATALOGUE: Entry[] = [
  {
    name: 'Button',
    summary: 'A soft raised button, pressed in while held or while aria-pressed is true.',
    states: [
      { label: 'Default', demo: <Button>Change sounds</Button> },
      { label: 'Primary', demo: <Button tone="primary">Tap to start audio</Button> },
      { label: 'Danger', demo: <Button tone="danger">Record</Button> },
      { label: 'Quiet', demo: <Button tone="quiet">Cancel</Button> },
      { label: 'Pressed (aria-pressed)', demo: <Button aria-pressed>Mute</Button> },
      { label: 'Disabled', demo: <Button disabled>Upload</Button> },
      {
        label: 'Sizes sm · md · lg',
        demo: (
          <span className="ds-row">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
          </span>
        ),
      },
    ],
    use: [
      'Any action with a text label.',
      'primary for the one main action in view; danger for record and destructive actions; quiet for a low-key secondary action such as Cancel.',
      'A toggle that reads as a pressed key (Mute, Solo): set aria-pressed.',
    ],
    avoid: [
      'An on/off setting: use Switch.',
      'More than one primary in the same group.',
      'An action with only an icon: use IconButton, which names it.',
    ],
  },
  {
    name: 'IconButton',
    summary:
      'A round soft button with only an icon; its label names it for screen readers and its tooltip.',
    states: [
      { label: 'Default', demo: <IconButton label="Slower">−</IconButton> },
      {
        label: 'Pressed (aria-pressed)',
        demo: (
          <IconButton label="Loop" aria-pressed>
            ⟳
          </IconButton>
        ),
      },
      {
        label: 'Disabled',
        demo: (
          <IconButton label="Faster" disabled>
            +
          </IconButton>
        ),
      },
    ],
    use: ['Steppers, close, and compact actions whose icon is unmistakable.'],
    avoid: [
      'An action people have to guess from the icon: use Button with text.',
      'Leaving out label: it is required, and it is the tooltip.',
    ],
  },
  {
    name: 'Switch',
    summary:
      'On or off, in two variants: an I/O rocker that tips toward the side that is on, or a knob that slides onto it and stretches while held, lighting the track or showing a mark like an LED readout. A native switch underneath, so iOS ticks.',
    states: [
      { label: 'Rocker, off', demo: <SwitchDemo /> },
      { label: 'Rocker, on', demo: <SwitchDemo on /> },
      { label: 'Rocker, disabled', demo: <SwitchDemo disabled /> },
      { label: 'Slide, off', demo: <SwitchDemo variant="slide" /> },
      { label: 'Slide, on', demo: <SwitchDemo variant="slide" on /> },
      { label: 'Slide with a readout (the theme)', demo: <ThemeToggle /> },
    ],
    use: [
      'Rocker: a setting of the music that is on or off and takes effect at once (the metronome).',
      'Slide: a preference of the app, not the music, especially one with two named sides (light and dark, with off and on marks).',
    ],
    avoid: [
      'An action that happens once: use Button.',
      'A choice between named options: use Select.',
      'Both variants side by side in one group: pick one.',
    ],
  },
  {
    name: 'Range',
    summary:
      'A mixer fader: a solid cap in a thin slot, an LED strip lit to the value in its colour, tick marks and a detent. The value shows while dragged.',
    states: [
      { label: 'At unity, with marks and a detent', demo: <RangeDemo start={1} marks /> },
      { label: 'Low, no marks', demo: <RangeDemo start={0.3} /> },
      { label: 'Disabled', demo: <RangeDemo start={0.6} marks disabled /> },
    ],
    use: [
      'A continuous level people adjust by feel, such as a loop’s volume.',
      'Give it marks where people aim, and a detent at the value they come back to (unity).',
      'Pass color when the fader belongs to something coloured (a track).',
    ],
    avoid: [
      'An exact number people type or step: use ScrubField.',
      'Tight space or a secondary parameter: use Knob.',
    ],
  },
  {
    name: 'Knob',
    summary:
      'A rotary control: drag up or right to turn it up, Shift for ten steps, Escape to put it back, double-click to reset. Screen readers hear a slider.',
    states: [
      { label: 'Middle', demo: <KnobDemo start={0.5} /> },
      { label: 'Full', demo: <KnobDemo start={1} /> },
      { label: 'Disabled', demo: <KnobDemo start={0.25} disabled /> },
    ],
    use: [
      'A secondary continuous parameter where a fader would take too much room.',
      'Give it a defaultValue that double-click returns to.',
    ],
    avoid: [
      'The main level of something: use Range, which reads at a glance.',
      'Values people type: use ScrubField.',
      'Anywhere in the jam yet: it waits for a control that needs it.',
    ],
  },
  {
    name: 'ScrubField',
    summary:
      'A number field whose label scrubs it: drag the label sideways to change the value, applied once on release. It can also be typed in and stepped with the arrow keys.',
    states: [
      { label: 'Resting', demo: <ScrubDemo /> },
      { label: 'With steppers (start, end)', demo: <ScrubDemo steppers /> },
      { label: 'Disabled (no scrub)', demo: <ScrubDemo steppers disabled /> },
    ],
    use: [
      'An exact number people also want to sweep, such as the tempo.',
      'Put steppers in start and end for touch and single steps.',
      'Clamp and explain in onChange: typed values arrive as typed.',
    ],
    avoid: [
      'A level adjusted by feel: use Range.',
      'Sending a change per pixel: it applies once on release, so keep it that way.',
    ],
  },
  {
    name: 'Select',
    summary: 'A soft button showing the current option that opens an OptionList in a Popover.',
    states: [{ label: 'Closed (open it)', demo: <SelectDemo /> }],
    use: ['Picking one of several named options, grouped if there are many.'],
    avoid: [
      'Two options that mean on and off: use Switch.',
      'A native <select>: it ignores the theme.',
    ],
  },
  {
    name: 'Popover',
    summary:
      'Floats its children beside an anchor, below or above, and closes on Escape or a press outside. Rendered into <body>.',
    states: [{ label: 'Closed (open it)', demo: <PopoverDemo /> }],
    use: ['A menu or short panel tied to the control that opened it.'],
    avoid: ['Anything people must finish before going on: that is a dialog.', 'Nesting popovers.'],
  },
  {
    name: 'OptionList',
    summary:
      'A list of options to pick one from: groups, notes, dots and disabled options, keyboard driven (↑ ↓ Home End, Enter or Space). It takes focus when it opens.',
    states: [{ label: 'Opened from an editing pad', demo: <OptionListDemo /> }],
    use: [
      'Inside a Popover, when the thing that opens it is not a Select button (a pad, say).',
      'Dots for who something belongs to; notes for a short muted detail.',
    ],
    avoid: ['Rendering it in the page flow: it grabs focus as it mounts.'],
  },
  {
    name: 'Pad',
    summary:
      'A pad’s face: a soft rubber square with its key moulded in and its sound’s name. Pressed, it is pushed in with a ring in --glow; lit, light spreads from inside it.',
    states: [
      { label: 'Resting', demo: <Pad keyLabel="q" name="Kick" /> },
      { label: 'Pressed', demo: <Pad keyLabel="w" name="Snare" lit="pressed" /> },
      { label: 'Lit by a loop', demo: <Pad keyLabel="e" name="Closed hat" lit="glow" /> },
      { label: 'Editing', demo: <Pad keyLabel="r" name="Clap" editing /> },
      {
        label: 'Upload, with its uploader',
        demo: (
          <Pad
            keyLabel="a"
            name="yeah.wav"
            dot={{ color: 'var(--ui-c)', title: 'Uploaded by you' }}
            status="ready"
          />
        ),
      },
      {
        label: 'Upload loading',
        demo: (
          <Pad
            keyLabel="s"
            name="vox-chop.wav"
            dot={{ color: 'var(--ui-c)', title: 'Uploaded by you' }}
            status="loading"
          />
        ),
      },
      {
        label: 'Upload missing',
        demo: (
          <Pad
            keyLabel="d"
            name="gone.wav"
            dot={{ color: 'var(--ui-c)', title: 'Uploaded by you' }}
            status="missing"
          />
        ),
      },
      {
        label: 'Long name',
        demo: <Pad keyLabel="f" name="a very long upload name that wraps onto three lines" />,
      },
    ],
    use: [
      'A pad in a grid that plays a sound. The owner decides what a press does and flashes pressed and glow itself.',
    ],
    avoid: [
      'A general-purpose button: use Button.',
      'Flashing hits through React state: set the pressed and glow classes on the element, as the console does.',
    ],
  },
]

## Purpose

The look and feel every jambo page shares: light and dark themes, the controls people press, drag and flip, and the design showcase that lists them with their rules.

## Requirements

### Requirement: Theme

Every page SHALL come in a light and a dark theme. It SHALL follow the system's setting until someone picks one with the theme switch; the pick SHALL then be remembered in this browser across visits. Collaborator colours SHALL be painted per theme with at least 3:1 contrast against the surface, and text with at least 4.5:1.

- **Scenario: First visit**
  - **GIVEN** a browser that never picked a theme, with the system in dark mode
  - **WHEN** someone opens a jam
  - **THEN** it shows the dark theme
- **Scenario: Pick a theme**
  - **WHEN** someone switches to light and opens a jam again the next day
  - **THEN** it shows the light theme
- **Scenario: Storage blocked**
  - **WHEN** the browser blocks local storage and someone flips the switch
  - **THEN** this page switches theme

### Requirement: Design showcase

The page at `/ds` SHALL show every shared control, each with its states (resting, hover, pressed, focused, disabled, held by someone else, and on/off or value where it has them) and its rules for when to use it, in the current theme. It SHALL have the theme switch and a choice of collaborator colour that repaints the controls.

- **Scenario: Browse the controls**
  - **WHEN** someone opens `/ds`
  - **THEN** they see the button, icon button, switch, slider, knob, XY pad, scrub field, select, menu, pad and tabs, each with its states and rules
- **Scenario: Try another colour**
  - **WHEN** someone picks coral on `/ds`
  - **THEN** the slider's lights, the knob's arc, the XY pad's puck and the focus rings turn coral

### Requirement: Slider

A slider SHALL show its value as a strip of lights in its colour, with its tick marks and a raised cap that can be dragged or moved with the arrow keys. While it is dragged, it SHALL show its value beside the cap. A slider with a detent SHALL snap to that value when dragged within 0.04 of it; the keys SHALL step past it.

- **Scenario: Find unity**
  - **GIVEN** a loop's level at 0.7
  - **WHEN** someone drags it to 0.98
  - **THEN** the level becomes 1.0, the unity mark lines up with the cap, and phones that support it tick
- **Scenario: Arrow keys**
  - **WHEN** someone focuses a level and presses the right arrow
  - **THEN** it goes up one step and its lights follow
- **Scenario: Leave unity by key**
  - **GIVEN** a loop's level at 1.0
  - **WHEN** someone presses the right arrow
  - **THEN** the level becomes 1.05

### Requirement: Switch

A switch SHALL show whether it is on in one of two looks: an I/O rocker that tips toward the side that is on, with the I lit when on, or a slide whose knob moves onto the side that is on. A click, a tap or Space SHALL flip it, and screen readers SHALL hear a switch.

- **Scenario: Flip the metronome**
  - **GIVEN** the metronome off
  - **WHEN** someone taps its switch
  - **THEN** the rocker tips to I, the I lights, and phones that support it tick
- **Scenario: Theme switch**
  - **WHEN** someone flips the theme switch
  - **THEN** its knob slides from the sun to the moon, or back

### Requirement: Knob

A knob SHALL turn when dragged up or right (increasing) and down or left (decreasing), in steps, with Shift for ten steps at a time, showing its value while turning. By default it SHALL apply the value once on release; a live knob SHALL instead apply it as it turns, at most once a frame. It SHALL take the arrow keys, Page Up and Page Down, Home and End. A double-click SHALL reset it to its default. Escape during a drag SHALL return it to where the drag started; a live knob SHALL apply that value again unless someone else changed it during the drag. A live knob pressed without moving SHALL apply nothing. A knob MAY be segmented into a number of lights; its ring SHALL then light a whole light at a time, as a slider's strip does. It SHALL announce itself as a slider with its value.

- **Scenario: Turn and cancel**
  - **GIVEN** a knob at 0.5
  - **WHEN** someone drags it up, then presses Escape before letting go
  - **THEN** it is back at 0.5 and nothing changed
- **Scenario: Reset**
  - **WHEN** someone double-clicks a knob
  - **THEN** it returns to its default
- **Scenario: Live knob**
  - **GIVEN** a live knob at 0
  - **WHEN** someone drags it up slowly to 0.6
  - **THEN** the values in between are applied as it turns, no more than one a frame, and 0.6 is applied last
- **Scenario: Segmented knob**
  - **GIVEN** a knob split into 16 lights, at its middle value
  - **WHEN** someone looks at it
  - **THEN** exactly 8 lights are lit, ending at 12 o'clock

### Requirement: Someone else moving a control

A slider, knob or XY pad SHALL be able to show that someone else is moving it: ringed in that person's colour, with their name in its bubble in their colour instead of the value. While it shows that, it SHALL NOT respond to drags or keys, and SHALL say it is held by that person to screen readers. Whoever is dragging it themselves SHALL still see their own value in the bubble.

- **Scenario: Watch someone turn a knob**
  - **GIVEN** a knob that Misty Yak is turning
  - **WHEN** someone else looks at it
  - **THEN** it is ringed in Misty Yak's colour, its bubble reads "Misty Yak", and its arc follows the value
- **Scenario: Try to drag it**
  - **GIVEN** a slider that Misty Yak is dragging
  - **WHEN** someone else drags it
  - **THEN** its value doesn't change for them, and Misty Yak's ring stays

### Requirement: Scrub a number

A number field with a scrub label SHALL change its value as someone drags the label sideways: right raises it, left lowers it, one step per few pixels, ten with Shift, within its range. The value SHALL show while dragging and SHALL be applied once, on release. Escape during a drag SHALL restore the starting value. A disabled field's label SHALL NOT scrub.

- **Scenario: Scrub up**
  - **GIVEN** a field at 100
  - **WHEN** someone drags its label 40 pixels right and lets go
  - **THEN** the field shows the higher value as they drag and applies it once when they let go
- **Scenario: Cancel**
  - **WHEN** someone presses Escape while scrubbing
  - **THEN** the field shows its starting value and nothing is applied

### Requirement: Haptics

On Android phones, flipping a switch, a slider landing on its detent, a slider passing each light of its strip, a knob passing each light of its ring (or each step when it has fewer), each step of a scrub, and pressing a pad SHALL give a light haptic tick, a firmer one at the detent. Steps closer together than 45 ms SHALL be dropped, so a fast drag ticks now and then instead of buzzing. Keys SHALL NOT tick. On iPhones, where pages can't start a tick, only switches SHALL tick, as the system's own switch. Haptics SHALL come only from the person's own touch or press, never from loops, other people's changes, or a pad lit by a loop's hit. Where haptics aren't supported, the controls SHALL work the same, without them.

- **Scenario: Desktop**
  - **WHEN** someone flips the metronome on a laptop
  - **THEN** it flips with no error and no tick
- **Scenario: Someone else's change**
  - **WHEN** another person sets a loop's level to unity
  - **THEN** this phone does not tick
- **Scenario: Press a pad**
  - **GIVEN** an Android phone
  - **WHEN** someone taps a pad
  - **THEN** it ticks, and when a loop hits that pad, it does not
- **Scenario: Fast drag**
  - **WHEN** someone flicks a fader from 0 to full on an Android phone
  - **THEN** it ticks a few times along the way, not on every light
- **Scenario: Keys**
  - **WHEN** someone moves a fader with the arrow keys
  - **THEN** nothing ticks

### Requirement: Pad

A pad SHALL show its key moulded into the middle of a raised rubber square, and its sound's name printed under it, centred, up to two lines and then an ellipsis, with the whole name on hover; the name SHALL never overlap the key. An uploaded sound's name SHALL carry its uploader's dot in a column of its own beside the name, show dimmed while loading, and end in "(missing)" when its file is gone. Pressed, a pad SHALL sink and squash slightly (only sink with reduced motion); lit by a loop, light SHALL spread from inside it. Screen readers SHALL hear a button named by its key, then its sound, then "(missing)" if so, then its uploader; hovering the pad or its name SHALL show the whole name.

- **Scenario: Long upload name**
  - **GIVEN** a pad whose sound is a 40-character upload, on a phone
  - **WHEN** someone looks at it
  - **THEN** the name takes two lines ending in "…" under the pad, beside its dot, and the key stays clear
- **Scenario: Screen reader**
  - **WHEN** a screen reader reaches the Q pad with Vox uploaded by Misty Yak
  - **THEN** it hears a button "Q Vox, Uploaded by Misty Yak"

### Requirement: Tabs

Tabs SHALL show one panel at a time under a row of folder tabs: the selected tab SHALL be part of the panel's card and the others SHALL sit behind it, and selecting a tab SHALL swap them at once. Tabs that don't fit the row SHALL go behind a "+N" tab whose menu lists them and selects the one picked; the selected tab SHALL always show. A click or tap SHALL select a tab; ← and → SHALL move through every tab, shown or not, selecting as they go, wrapping at the ends and skipping disabled tabs; Home and End SHALL jump to the first and last. Screen readers SHALL hear a tab list.

- **Scenario: Keyboard**
  - **GIVEN** the first tab selected and focused
  - **WHEN** someone presses → twice
  - **THEN** the third tab is selected and its panel shows
- **Scenario: Phone**
  - **WHEN** someone opens the AI apps on `/about` on a 375px-wide phone
  - **THEN** they see Claude, Claude Code, ChatGPT and "+3", and nothing spills past the card's edges
- **Scenario: Pick from +N**
  - **WHEN** they pick Codex from "+3"
  - **THEN** Codex is selected and shows in place of ChatGPT, and "+3" lists the others
- **Scenario: Wrap**
  - **GIVEN** Other, the last tab, selected
  - **WHEN** someone presses →
  - **THEN** Claude is selected

### Requirement: XY pad

An XY pad SHALL set two values at once from where it is pressed and dragged inside its square, showing a puck at its position and the lines through it, in its colour. Arrow keys SHALL move the puck a step on each axis, with Shift for ten steps. A live XY pad SHALL apply as it moves, at most once a frame, and leave the puck where it was released. Escape during a drag SHALL return it to where the drag started. It SHALL announce itself as two sliders, one per axis, with their values.

- **Scenario: Drag the puck**
  - **WHEN** someone presses the middle of a pad and drags to its top-left corner
  - **THEN** the puck follows, the values move to the corner's, and the puck stays there when released
- **Scenario: Move the puck by key**
  - **WHEN** someone focuses a pad and presses the up arrow
  - **THEN** Y goes up one step and the puck follows

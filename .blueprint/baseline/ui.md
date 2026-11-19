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

The page at `/ds` SHALL show every shared control, each with its states (resting, hover, pressed, focused, disabled, and on/off or value where it has them) and its rules for when to use it, in the current theme. It SHALL have the theme switch and a choice of collaborator colour that repaints the controls.

- **Scenario: Browse the controls**
  - **WHEN** someone opens `/ds`
  - **THEN** they see the button, icon button, switch, slider, knob, scrub field, select, menu and pad, each with its states and rules
- **Scenario: Try another colour**
  - **WHEN** someone picks coral on `/ds`
  - **THEN** the slider's lights, the knob's arc and the focus rings turn coral

### Requirement: Slider

A slider SHALL show its value as a strip of lights in its colour, with its tick marks and a raised cap that can be dragged or moved with the arrow keys. While it is dragged, it SHALL show its value beside the cap. A slider with a detent SHALL snap to that value when dragged within 0.04 of it; the keys SHALL step past it.

- **Scenario: Find unity**
  - **GIVEN** a loop's level at 0.7
  - **WHEN** someone drags it to 0.98
  - **THEN** the level becomes 1.0, the unity mark lines up with the cap, and phones that support it tick
- **Scenario: Keyboard**
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

A knob SHALL turn when dragged up or right (increasing) and down or left (decreasing), in steps, with Shift for ten steps at a time, showing its value while turning and applying it once on release. It SHALL take the arrow keys, Page Up and Page Down, Home and End. A double-click SHALL reset it to its default. Escape during a drag SHALL return it to where the drag started. It SHALL announce itself as a slider with its value.

- **Scenario: Turn and cancel**
  - **GIVEN** a knob at 0.5
  - **WHEN** someone drags it up, then presses Escape before letting go
  - **THEN** it is back at 0.5 and nothing changed
- **Scenario: Reset**
  - **WHEN** someone double-clicks a knob
  - **THEN** it returns to its default

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

On phones that support it, flipping a switch, crossing a slider's detent, and each step of a knob or scrub SHALL give a light haptic tick. On iPhones, where pages can't start a tick, only switches SHALL tick, as the system's own switch. Haptics SHALL come only from the person's own touch, never from loops or other people's changes. Where haptics aren't supported, the controls SHALL work the same, without them.

- **Scenario: Desktop**
  - **WHEN** someone flips the metronome on a laptop
  - **THEN** it flips with no error and no tick
- **Scenario: Someone else's change**
  - **WHEN** another person sets a loop's level to unity
  - **THEN** this phone does not tick

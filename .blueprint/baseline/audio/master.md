## Purpose

Shape the whole jam's mix together: a touchpad of performance effects and master knobs that everyone in the jam hears and anyone can steer.

## Requirements

### Requirement: Master chain

Every loop SHALL play through the jam's master stage: the touchpad's filter, throw and lo-fi, then master tone, drive and width, in that order. Pads played live SHALL go through it too; the count-in and the metronome SHALL stay dry. With every master setting at its default, the jam SHALL sound as it did without a master stage.

- **Scenario: Older jam**
  - **GIVEN** a jam made before master effects existed
  - **WHEN** someone opens it
  - **THEN** every loop sounds as it did, every master knob reads its default, and every pad mode is at 0/0
- **Scenario: Clicks stay dry**
  - **GIVEN** the filter mode at x -1
  - **WHEN** someone records with the metronome on
  - **THEN** the loops sound dark and the clicks do not

### Requirement: Master knobs

A jam SHALL have four master knobs, each defaulting to the value that leaves the mix unchanged:

- tone (−1 to 1, default 0): darkens below 0 and thins above 0, as a track's tone does;
- drive (0 to 1, default 0): saturates the mix and evens its loudness;
- width (−1 to 1, default 0): narrows the stereo image to mono at −1 and widens it above 0;
- swing (0 to 1, default 0): delays every off-beat 16th note of every loop, by up to half a 16th at 1.

Turning one SHALL change the sound for everyone in the jam while it turns, and the setting SHALL stay until someone changes it. A double-click SHALL reset a knob to its default.

- **Scenario: Darken everything**
  - **GIVEN** two people in a jam with two loops playing
  - **WHEN** one turns master tone to -0.6
  - **THEN** both hear both loops darken while it turns
- **Scenario: Width to mono**
  - **WHEN** someone sets width to -1
  - **THEN** a loop panned hard left plays equally from both speakers
- **Scenario: Knobs kept on reload**
  - **GIVEN** master drive at 0.4
  - **WHEN** someone reloads the jam
  - **THEN** drive reads 0.4 and the mix sounds driven

### Requirement: Swing

Swing SHALL move only when hits play, after a track's snap, never the hits a track stores. It SHALL move only hits that land on an off-beat 16th note. Pads played live SHALL NOT be swung.

- **Scenario: Swung hats**
  - **GIVEN** a jam at 120 BPM with a loop hitting every 16th note
  - **WHEN** someone sets swing to 1
  - **THEN** every second hit sounds 62.5 ms late, and the track still stores the same beats
- **Scenario: Downbeats stay**
  - **GIVEN** swing at 1
  - **WHEN** a loop hits beat 2
  - **THEN** it sounds on beat 2

### Requirement: Touchpad modes

The touchpad SHALL have four modes: Filter, Throw, Lo-fi and Repeat. Each SHALL have its own X and Y position, shared with the jam and kept where it is left. All four SHALL sound at once, each from its own position. At 0/0 a mode SHALL be off. Each person SHALL choose which mode their touchpad shows, without changing anyone else's view. Each mode SHALL have a reset that puts it back to 0/0 for everyone. A mode away from 0/0 SHALL show a dot on its tab.

- **Scenario: Two modes at once**
  - **GIVEN** Misty Yak on Filter and Groovy Otter on Throw
  - **WHEN** both drag their pads
  - **THEN** everyone hears both the filter and the throw, and each keeps seeing their own mode
- **Scenario: Latched**
  - **WHEN** someone drags Filter to x -0.5 and lets go
  - **THEN** the filter stays at x -0.5 for everyone until someone moves or resets it
- **Scenario: Reset**
  - **GIVEN** Lo-fi at x 0.7, y 0.8
  - **WHEN** someone presses Lo-fi's reset
  - **THEN** Lo-fi goes to 0/0 for everyone, the mix is clean again, and its tab's dot goes away
- **Scenario: Modes kept on reload**
  - **GIVEN** Filter latched at x 0.6
  - **WHEN** someone reloads the jam
  - **THEN** the filter still sounds and Filter's tab shows a dot

### Requirement: Filter mode

X SHALL sweep a filter over the whole mix: below 0 a low-pass closing toward the left edge, above 0 a high-pass rising toward the right edge, and fully open at 0. Y SHALL raise the filter's resonance from none at 0 to strong at 1.

- **Scenario: Sweep down**
  - **WHEN** someone drags Filter from x 0 to x -1
  - **THEN** the whole mix darkens steadily until only the low end is left

### Requirement: Throw mode

Y SHALL send the whole mix into an echo, from none at 0 to a long, loud tail at 1 that never runs away. X SHALL pick the echo's time on the jam's tempo: an eighth note in its first third, a dotted eighth in its middle third, a quarter note in its last third. Echoes already sounding SHALL keep ringing out after Throw is moved down or reset.

- **Scenario: Throw a quarter note**
  - **GIVEN** a jam at 120 BPM
  - **WHEN** someone drags Throw to x 0.9, y 0.8
  - **THEN** the mix repeats every 500 ms, fading slowly
- **Scenario: Tail after reset**
  - **WHEN** someone resets Throw while its echoes are sounding
  - **THEN** no new sound goes into the echo, and the tail fades out

### Requirement: Lo-fi mode

X SHALL lower the mix's sample rate and Y its bit depth, from untouched at 0 to coarse at 1.

- **Scenario: Crunch**
  - **WHEN** someone drags Lo-fi to x 0.8, y 0.8
  - **THEN** the whole mix sounds gritty and aliased for everyone

### Requirement: Repeat mode

With Y above 0, Repeat SHALL capture a slice of the loops' pattern, starting at the next grid line of the slice's length, and play that slice's hits over and over in place of what the loops would play. Y SHALL set the repeats' level against the loops, with only repeats at 1. X SHALL pick the slice: a quarter, eighth, sixteenth or thirty-second note, in four equal zones from left to right. Moving X to another zone SHALL capture a new slice at the next grid line. Setting Y to 0 SHALL return the loops to playing as they were, at the next 1/16. Every client SHALL repeat the same hits.

- **Scenario: Stutter a beat**
  - **GIVEN** a one-bar loop playing
  - **WHEN** someone drags Repeat to the 1/4 zone with y 1 during beat 2
  - **THEN** from beat 3 everyone hears beat 3's hits repeating every beat, and nothing else of the loop
- **Scenario: Back to the loop**
  - **WHEN** Repeat goes to y 0
  - **THEN** from the next 1/16 the loops play where they would have been, still on the jam's bar grid

### Requirement: Heard together

Turning Repeat on or off, changing its slice, and changing Throw's echo time SHALL take effect at the next 1/16 note of the jam's grid, for everyone, including whoever is steering. Every other master change SHALL take effect at once for whoever makes it, and as soon as it reaches them for everyone else.

- **Scenario: Same stutter**
  - **GIVEN** two people in a jam
  - **WHEN** one engages Repeat
  - **THEN** both hear the first repeat start on the same 1/16, within 20 ms of each other
- **Scenario: On the grid for whoever steers**
  - **WHEN** someone moves Throw's echo time or engages Repeat
  - **THEN** they hear it from the next 1/16 line too, not at once

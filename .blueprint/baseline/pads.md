## Purpose

The mini board everyone in a jam plays.

## Requirements

### Requirement: Pad grid

A jam SHALL have a 4×4 grid of pads, each with a sound and a keyboard key, the same for everyone in the jam. The keys SHALL be `1234`, `QWER`, `ASDF` and `ZXCV`, row by row, and a pad SHALL light up briefly when played.

- **Scenario: Play a pad**
  - **WHEN** someone clicks a pad or presses its key
  - **THEN** its sound plays for them right away and the pad lights up
- **Scenario: Typing in a field**
  - **WHEN** someone types `q` into a track name
  - **THEN** no pad plays
- **Scenario: Shortcuts and held keys**
  - **WHEN** someone presses Cmd, Ctrl or Alt with a pad key, or holds a pad key down
  - **THEN** the pad plays at most once, and not at all with a modifier

### Requirement: Assign a sound

Anyone in the jam SHALL be able to assign any sound from the kit to any pad, and the change SHALL reach everyone.

- **Scenario: Reassign**
  - **WHEN** someone chooses Change sounds and picks the clap for the pad on key `Q`
  - **THEN** every client plays the clap on `Q`, including in existing tracks that use that pad

### Requirement: Default layout

The default layout SHALL put drums and percussion on the top three rows and tonal sounds on the bottom row.

- **Scenario: New jam**
  - **WHEN** someone opens a new jam
  - **THEN** all 16 pads have sounds, with the kick on key `1` and the tonal sounds on `ZXCV`

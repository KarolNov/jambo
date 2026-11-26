## Purpose

The mini board everyone in a jam plays.

## Requirements

### Requirement: Pad grid

A jam SHALL have a 4×4 grid of pads, each with a sound and a keyboard key, the same for everyone in the jam. The keys SHALL be `1234`, `QWER`, `ASDF` and `ZXCV`, row by row. Pressing a pad SHALL push it in briefly, ringed in the presser's colour, and a loop's hit SHALL light its pad in the loop's colour as it is heard.

- **Scenario: Play a pad**
  - **WHEN** someone clicks a pad or presses its key
  - **THEN** its sound plays for them right away and the pad pushes in
- **Scenario: A loop plays through a pad**
  - **GIVEN** a coral loop with a hit on the kick
  - **WHEN** it plays
  - **THEN** the kick pad glows coral each time that hit is heard
- **Scenario: Typing in a field**
  - **WHEN** someone types `q` into a track name
  - **THEN** no pad plays
- **Scenario: Shortcuts and held keys**
  - **WHEN** someone presses Cmd, Ctrl or Alt with a pad key, or holds a pad key down
  - **THEN** the pad plays at most once, and not at all with a modifier

### Requirement: Assign a sound

Anyone in the jam SHALL be able to assign any sound from the kit or the jam's uploads to any pad, and the change SHALL reach everyone. The sound menu SHALL list the kit by category, then the jam's uploads, then Upload a sound…; voice clips SHALL NOT be listed. An uploaded sound SHALL carry a dot in its uploader's colour, on its pad and in the menu, saying who uploaded it.

- **Scenario: Reassign**
  - **WHEN** someone chooses Change sounds, clicks the pad on key `Q` and picks the clap from its menu
  - **THEN** every client plays the clap on `Q`, including in existing tracks that use that pad
- **Scenario: Pick an upload**
  - **GIVEN** a jam with an upload called Vox
  - **WHEN** someone picks Vox for the pad on key `A`
  - **THEN** every client plays Vox on `A` once it has loaded
- **Scenario: Who uploaded it**
  - **GIVEN** a pad holding Vox, uploaded by Misty Yak
  - **WHEN** someone points at the dot beside its name
  - **THEN** it says "Uploaded by Misty Yak", or "Uploaded by you" for its uploader; a sound uploaded before names says the uploader's colour
- **Scenario: Clips stay out of the menu**
  - **GIVEN** a jam whose tracks hold three voice clips
  - **WHEN** someone opens a pad's sound menu
  - **THEN** no clip is listed

### Requirement: Default layout

The default layout SHALL put drums and percussion on the top three rows and tonal sounds on the bottom row.

- **Scenario: New jam**
  - **WHEN** someone opens a new jam
  - **THEN** all 16 pads have sounds, with the kick on key `1` and the tonal sounds on `ZXCV`

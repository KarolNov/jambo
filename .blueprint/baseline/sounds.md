## Purpose

The fixed set of sounds a jam can use.

## Requirements

### Requirement: Fixed kit

The app SHALL offer a fixed kit of 17 one-shot sounds, each with a stable id and a name, in four groups: drums, percussion, tonal and fx. The sounds SHALL be generated in the browser, so nothing is downloaded or uploaded, and an id SHALL never be reused for a different sound.

- **Scenario: Load the kit**
  - **WHEN** audio starts in a jam
  - **THEN** every sound in the kit can be played

### Requirement: Unknown sound

A pad that refers to a sound id the kit does not have SHALL play nothing and show as empty.

- **Scenario: Removed sound**
  - **GIVEN** a pad whose stored sound id is not in the kit
  - **WHEN** someone plays it
  - **THEN** nothing sounds and the pad reads Empty

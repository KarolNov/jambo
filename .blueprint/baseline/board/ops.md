## Purpose

The only way to write to a board, used by the UI and, later, by code and AI.

## Requirements

### Requirement: Operations are data

Every change to a board SHALL be expressible as a serializable operation, and applying the same operations to the same board SHALL give the same result.

- **Scenario: Replay**
  - **GIVEN** a list of operations applied to an empty board
  - **WHEN** the same list is applied to another empty board
  - **THEN** both boards are equal

### Requirement: One batch, one change

A batch of operations SHALL be applied as one change that everyone in the jam receives together, tagged with who made it.

- **Scenario: Batch with origin**
  - **WHEN** a client applies three operations as one batch
  - **THEN** other clients see all three at once, and the change carries the client's origin

### Requirement: Tempo lock

A tempo change SHALL be refused while the jam has tracks. Only tracks that pass the board's schema SHALL count.

- **Scenario: Locked**
  - **GIVEN** a jam with one track
  - **WHEN** an operation sets the tempo
  - **THEN** it is refused with an issue saying the tempo is locked
- **Scenario: Unreadable track**
  - **GIVEN** a jam whose only stored track does not pass the schema
  - **WHEN** an operation sets the tempo
  - **THEN** the tempo changes

### Requirement: Track limits

A jam SHALL hold at most 32 readable tracks. A track SHALL have 1 to 16 bars, 1 to 512 hits that all fall inside its loop, a name of 1 to 40 characters after trimming, a level from 0 to 1.5, a snap of off, 1/32, 1/16, 1/8 or 1/4, and no effects.

- **Scenario: Hit outside the loop**
  - **WHEN** an operation adds a one-bar track with a hit on beat 4
  - **THEN** it is refused and no track is added
- **Scenario: Full jam**
  - **GIVEN** a jam with 32 tracks
  - **WHEN** an operation adds another
  - **THEN** it is refused

### Requirement: Pad sounds from the kit or uploads

Assigning a sound SHALL need an existing pad and a sound from the kit or one of the jam's listed uploads.

- **Scenario: Unknown sound**
  - **WHEN** an operation assigns the sound `kik` to a pad
  - **THEN** it is refused and the pad keeps its sound
- **Scenario: Upload**
  - **GIVEN** a jam listing the upload `u-abc123def456`
  - **WHEN** an operation assigns it to a pad
  - **THEN** the pad's sound changes

### Requirement: Upload list

Only the room SHALL add, remove or expire uploads; the same operations from anyone else SHALL be refused. Adding an upload SHALL need a new upload-form id and room in the jam (at most 32). Removing one SHALL be refused while any pad names it, including a pad that does not pass the schema. Expiring SHALL remove every upload from the list.

- **Scenario: Remove in use**
  - **GIVEN** an upload on one pad
  - **WHEN** an operation removes it
  - **THEN** it is refused and the upload stays
- **Scenario: Kit id**
  - **WHEN** an operation adds an upload with the id `kick`
  - **THEN** it is refused
- **Scenario: Not the room**
  - **WHEN** a client, not the room, applies an operation that adds an upload
  - **THEN** it is refused and the upload list is unchanged

### Requirement: Replace a sound

Moving every pad from one sound to another SHALL be one operation. The new sound SHALL be from the kit or one of the jam's listed uploads; otherwise the operation SHALL be refused and no pad SHALL change.

- **Scenario: Two pads**
  - **GIVEN** an upload on two pads
  - **WHEN** an operation replaces it with the clap
  - **THEN** both pads change to the clap in one change, and the other pads keep their sounds
- **Scenario: Unknown sound**
  - **WHEN** an operation replaces a sound with one the jam does not list, even one no pad uses
  - **THEN** it is refused

### Requirement: Editable track fields

After a track is added, only its name, level, mute and snap SHALL be changeable; its bars, hits, author and colour SHALL stay as recorded.

- **Scenario: Mute and rename**
  - **WHEN** an operation sets a track's mute and name
  - **THEN** both change and its hits stay the same

### Requirement: Unknown targets

An operation on a missing track or pad, or adding a track with an id that already exists, SHALL be refused and change nothing.

- **Scenario: Remove a missing track**
  - **WHEN** an operation removes a track id the jam does not have
  - **THEN** it is refused and the board is unchanged

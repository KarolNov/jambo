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

A jam SHALL hold at most 32 readable tracks. A track SHALL have 1 to 16 bars, 1 to 512 hits that all fall inside its loop, each naming a pad or a sound from the kit or the jam's listed uploads and clips, a name of 1 to 40 characters after trimming, a level from 0 to 1.5, a snap of off, 1/32, 1/16, 1/8 or 1/4, no effects, and optionally a reverb and an echo from 0 to 1, a tone and a pan from -1 to 1, and a pitch of a whole number of semitones from -12 to 12.

- **Scenario: Hit outside the loop**
  - **WHEN** an operation adds a one-bar track with a hit on beat 4
  - **THEN** it is refused and no track is added
- **Scenario: Full jam**
  - **GIVEN** a jam with 32 tracks
  - **WHEN** an operation adds another
  - **THEN** it is refused
- **Scenario: Pitch out of range**
  - **WHEN** an operation sets a track's pitch to 13, or to 2.5
  - **THEN** it is refused and the track keeps its pitch
- **Scenario: Hit on an unlisted sound**
  - **WHEN** an operation adds a track with a hit naming the sound `u-aaaaaaaaaaaa`, which the jam doesn't list
  - **THEN** it is refused and no track is added

### Requirement: Pad sounds from the kit or uploads

Assigning a sound SHALL need an existing pad and a sound from the kit or one of the jam's listed uploads. A clip SHALL NOT be assignable to a pad.

- **Scenario: Unknown sound**
  - **WHEN** an operation assigns the sound `kik` to a pad
  - **THEN** it is refused and the pad keeps its sound
- **Scenario: Upload**
  - **GIVEN** a jam listing the upload `u-abc123def456`
  - **WHEN** an operation assigns it to a pad
  - **THEN** the pad's sound changes
- **Scenario: Clip on a pad**
  - **GIVEN** a jam listing a clip
  - **WHEN** an operation assigns it to a pad
  - **THEN** it is refused and the pad keeps its sound

### Requirement: Upload list

Only the room SHALL add, remove or expire uploads and clips; the same operations from anyone else SHALL be refused. Adding one SHALL need a new upload-form id and room in the jam: at most 32 uploads and, separately, at most 64 clips. Removing one SHALL be refused while any pad or any track's hit names it, including a pad or track that does not pass the schema. Expiring SHALL remove every upload and clip from the list.

- **Scenario: Remove in use**
  - **GIVEN** an upload on one pad
  - **WHEN** an operation removes it
  - **THEN** it is refused and the upload stays
- **Scenario: Remove a clip a track names**
  - **GIVEN** a clip named by a hit in one track
  - **WHEN** an operation removes it
  - **THEN** it is refused and the clip stays
- **Scenario: Kit id**
  - **WHEN** an operation adds an upload with the id `kick`
  - **THEN** it is refused
- **Scenario: Not the room**
  - **WHEN** a client, not the room, applies an operation that adds an upload
  - **THEN** it is refused and the upload list is unchanged
- **Scenario: Uploads don't fill clips**
  - **GIVEN** a jam with 32 uploads and 10 clips
  - **WHEN** the room adds a clip
  - **THEN** it is listed

### Requirement: Replace a sound

Moving every pad and every track hit from one sound to another SHALL be one operation. The new sound SHALL be from the kit or one of the jam's listed uploads; otherwise the operation SHALL be refused and nothing SHALL change.

- **Scenario: Two pads**
  - **GIVEN** an upload on two pads
  - **WHEN** an operation replaces it with the clap
  - **THEN** both pads change to the clap in one change, and the other pads keep their sounds
- **Scenario: A track's sound hits**
  - **GIVEN** an upload named by two hits in one track and on no pad
  - **WHEN** an operation replaces it with another upload
  - **THEN** both hits name the new upload, and the track's other hits are unchanged
- **Scenario: Replace with an unknown sound**
  - **WHEN** an operation replaces a sound with one the jam does not list, even one no pad uses
  - **THEN** it is refused

### Requirement: Editable track fields

After a track is added, only its name, level, mute, snap, reverb, echo, tone, pitch and pan SHALL be changeable; its bars, hits, author and colour SHALL stay as recorded, except that replacing a sound moves the hits that name it.

- **Scenario: Mute and rename**
  - **WHEN** an operation sets a track's mute and name
  - **THEN** both change and its hits stay the same
- **Scenario: Set sound knobs**
  - **WHEN** an operation sets a track's reverb to 0.5 and pan to -0.3
  - **THEN** both change and its other settings stay the same

### Requirement: Unknown targets

An operation on a missing track or pad, or adding a track with an id that already exists, SHALL be refused and change nothing.

- **Scenario: Remove a missing track**
  - **WHEN** an operation removes a track id the jam does not have
  - **THEN** it is refused and the board is unchanged

### Requirement: Master settings

A board SHALL hold its master settings as one value per control: tone, drive, width and swing, each a number in its range, and filter, throw, lo-fi and repeat, each an X and Y in its range, with repeat also storing the jam beat its slice starts on. One operation SHALL set any of the master knobs, and another SHALL set one pad mode's position. A value out of range, an unknown knob or an unknown mode SHALL be refused and change nothing. Changes to different controls made at the same time SHALL all be kept; of two changes to the same control, the last SHALL win.

- **Scenario: Set the drive**
  - **WHEN** an operation sets master drive to 0.4
  - **THEN** drive is 0.4 and the other master settings are unchanged
- **Scenario: Out of range**
  - **WHEN** an operation sets Filter to x -1.5
  - **THEN** it is refused and Filter keeps its position
- **Scenario: Two controls at once**
  - **GIVEN** two clients offline
  - **WHEN** one sets Filter and the other sets Throw, and both reconnect
  - **THEN** the board holds both changes
- **Scenario: Lots of moves**
  - **WHEN** two people drag Filter and Throw back and forth for a minute
  - **THEN** the board still stores one value per control

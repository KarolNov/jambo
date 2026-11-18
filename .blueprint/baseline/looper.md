## Purpose

Record loops from pad hits and keep every loop in the jam playing together.

## Requirements

### Requirement: Tempo

A jam SHALL have one tempo, a whole number of BPM from 40 to 240 (default 100), in 4/4. It SHALL change only while the jam has no tracks and no take is being recorded.

- **Scenario: Locked by tracks**
  - **GIVEN** a jam with one track
  - **WHEN** someone tries to change the tempo
  - **THEN** the change is refused, and the tempo control shows a lock and says why
- **Scenario: Locked while recording**
  - **GIVEN** a count-in or a take in progress
  - **WHEN** the person recording looks at the tempo control
  - **THEN** it is disabled
- **Scenario: Out of range**
  - **WHEN** someone enters 300
  - **THEN** the tempo becomes 240 and the transport says the range is 40–240 BPM
- **Scenario: Cancel an edit**
  - **WHEN** someone types a tempo and presses Escape, or clears the field and leaves it
  - **THEN** the tempo stays as it was

### Requirement: Count-in

Recording SHALL start with a one-bar count-in that clicks every beat, even with the metronome off. The count-in SHALL start at the jam's next bar, so every take is in phase with the jam.

- **Scenario: Stop during the count-in**
  - **WHEN** someone presses record and stops before the count-in ends
  - **THEN** no track is added and the transport says nothing was recorded
- **Scenario: Nothing looping**
  - **GIVEN** a jam with no tracks
  - **WHEN** someone presses record halfway through a jam bar
  - **THEN** the count-in starts at the next jam bar, and the transport shows it is waiting until then

### Requirement: Record a take

After the count-in, every pad hit SHALL be captured with its position in beats until stop. A hit up to 1/4 beat before the first beat SHALL count as on it. Space SHALL toggle record and stop.

- **Scenario: Record**
  - **WHEN** someone presses record, waits the count-in, plays four hits and presses stop
  - **THEN** a new track holds those four hits at the beats they were played
- **Scenario: Slightly early first hit**
  - **WHEN** the first hit lands 1/8 beat before the take starts
  - **THEN** it is stored on beat 0

### Requirement: Whole bars

A take's length SHALL round up to whole bars, from 1 to 16 bars. A stop up to 1/8 bar past a bar line SHALL count as on it. Hits past the end SHALL be dropped, and a track SHALL keep at most 512 hits.

- **Scenario: Stop mid-bar**
  - **WHEN** a take is stopped 2.3 bars after it started
  - **THEN** the new track is 3 bars long
- **Scenario: Slightly late stop**
  - **WHEN** a take is stopped 2.1 bars after it started
  - **THEN** the new track is 2 bars long

### Requirement: Empty takes

A take with no hits SHALL be discarded.

- **Scenario: Nothing played**
  - **WHEN** someone records and stops without hitting a pad
  - **THEN** no track is added

### Requirement: Every take is a track

Each take SHALL become its own track, named after the recorder's colour and their count of tracks (for example `Teal 3`), at full level, unmuted, snapping to 1/16. Takes recorded at the same time by different people SHALL all be kept.

- **Scenario: Two people record**
  - **WHEN** two people in a jam record and stop at overlapping times
  - **THEN** the jam has two new tracks, one from each

### Requirement: Loop playback

Every unmuted track SHALL play in a loop at its level, on the jam's shared bar grid: everyone in a jam SHALL hear each loop's downbeats within 20 ms of each other. A track's loop SHALL start on the jam bar where its take began and repeat every length. A track someone else adds SHALL start playing right away, from its current point in the loop. A track the listener just recorded SHALL keep looping from where its take started, without a gap.

- **Scenario: Same downbeat**
  - **GIVEN** two people in a jam with a one-bar track
  - **WHEN** both listen
  - **THEN** they hear its first hit within 20 ms of each other on every loop
- **Scenario: A track joins**
  - **GIVEN** a two-bar track playing
  - **WHEN** someone else adds a one-bar track mid-bar
  - **THEN** it plays right away from its current point in the loop, and loops twice for each loop of the first
- **Scenario: Your own take**
  - **WHEN** someone stops a take
  - **THEN** their new loop carries on in time with what they just played
- **Scenario: Join a playing jam**
  - **WHEN** someone opens a jam whose loops are playing for others
  - **THEN** they hear each loop at the same point in it as everyone else

### Requirement: Quantize

Each track SHALL play its hits snapped to its grid (off, 1/32, 1/16, 1/8 or 1/4), while keeping the recorded positions. A hit snapped past the loop's end SHALL play at its start.

- **Scenario: Slightly late hit**
  - **GIVEN** a hit recorded at beat 1.06
  - **WHEN** the track plays with 1/16 quantize
  - **THEN** the hit sounds at beat 1, and the track still stores 1.06

### Requirement: Track controls

Anyone in the jam SHALL be able to mute, set the level (0 to 1.5) of, rename, change the snap of and remove any track. A name SHALL be 1 to 40 characters after trimming. Each track SHALL show its length in bars, its number of hits and its hits across the loop, and, while it plays, a playhead and a ring showing how far through the loop it is.

- **Scenario: Mute someone's loop**
  - **WHEN** one person mutes a track another person recorded
  - **THEN** it goes silent for everyone in the jam
- **Scenario: Blank name**
  - **WHEN** someone clears a track's name
  - **THEN** the row shows an error and the track keeps its old name

### Requirement: Metronome

While it is on, the metronome SHALL click every beat of a take, on the jam's beats, and SHALL NOT click when nothing is being recorded. It SHALL be on by default, and each browser SHALL remember the setting.

- **Scenario: Loops without clicks**
  - **GIVEN** the metronome is on and loops are playing
  - **WHEN** nobody on this client is recording
  - **THEN** no click sounds
- **Scenario: Metronome off**
  - **GIVEN** the metronome is off
  - **WHEN** someone records
  - **THEN** only the count-in clicks
- **Scenario: Two people record**
  - **WHEN** two people in a jam record at the same time with the metronome on
  - **THEN** their clicks land within 20 ms of each other

### Requirement: Jam clock

Each client SHALL agree its clock with the jam before its first take; until then the record control SHALL say it is syncing and SHALL NOT start a take. A client that goes offline SHALL keep playing on its last agreement.

- **Scenario: Record right after opening**
  - **WHEN** someone opens a jam and presses record before the clock is agreed
  - **THEN** the record control says it is syncing, and recording can start once it is agreed (normally under a second)
- **Scenario: Offline**
  - **GIVEN** loops are playing
  - **WHEN** the connection drops
  - **THEN** the loops keep playing on the same downbeat

### Requirement: Start audio

Sound SHALL start only after a user gesture. Until then the jam SHALL show a "Tap to start audio" control, and pressing a pad or record SHALL also start it.

- **Scenario: First press**
  - **WHEN** someone opens a jam and presses record
  - **THEN** audio starts and the count-in begins

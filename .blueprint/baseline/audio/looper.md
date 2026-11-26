## Purpose

Record loops from pad hits and keep every loop in the jam playing together.

## Requirements

### Requirement: Tempo

A jam SHALL have one tempo, a whole number of BPM from 40 to 240 (default 100), in 4/4. It SHALL change only while the jam has no tracks and no take is being recorded. Besides typing it and stepping it, someone SHALL be able to scrub it by dragging its BPM label, which changes it for everyone once they let go.

- **Scenario: Locked by tracks**
  - **GIVEN** a jam with one track
  - **WHEN** someone taps the tempo's buttons, its field, its BPM label or the lock beside it
  - **THEN** nothing changes, and a note saying the tempo is locked while the jam has loops shows for a few seconds, on phones as on desktop
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
- **Scenario: Scrub the tempo**
  - **GIVEN** a jam at 100 BPM with no tracks
  - **WHEN** someone drags the BPM label to the right and lets go at 112
  - **THEN** the tempo is 112 for everyone in the jam, applied once

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

### Requirement: Take display

While a take is being recorded, the readout SHALL show it in place of the tempo, as heard. During the count-in it SHALL show the count (1–4); while recording, the bar being recorded, counted from 1. Beside it, the beats of the bar SHALL show as 1 2 3 4 with the current one lit in the recorder's colour. Under them, a lane SHALL show the take so far, growing a bar at a time up to 16 bars, with a playhead and each hit where it will play, snapped to 1/16. Only the person recording SHALL see it, and between takes the readout SHALL show the tempo again.

- **Scenario: Count along**
  - **WHEN** someone presses record and plays into the take's second bar
  - **THEN** the readout counts 1 to 4 through the count-in, then shows bar 1, then bar 2 on a two-bar lane, with the current beat lit
- **Scenario: See where a hit lands**
  - **WHEN** someone plays a hit at beat 1.1 of a take
  - **THEN** a mark shows on the lane at beat 1 right away, and after stop the track stores 1.1
- **Scenario: Others keep the tempo**
  - **WHEN** one person in a jam records
  - **THEN** everyone else's readout keeps showing the tempo

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

Each take SHALL become its own track, named after the recorder's name in the jam and the next number after the jam's takes with that name (for example `Groovy Otter 3` after `Groovy Otter 2`), at full level, unmuted, snapping to 1/16. Takes recorded at the same time by different people SHALL all be kept.

- **Scenario: Two people record**
  - **WHEN** two people in a jam record and stop at overlapping times
  - **THEN** the jam has two new tracks, one from each
- **Scenario: A name passed on**
  - **GIVEN** a track `Groovy Otter 1` by someone who has left
  - **WHEN** someone else, now seated as Groovy Otter, records a take
  - **THEN** their track is `Groovy Otter 2`

### Requirement: Loop playback

Every unmuted track SHALL play in a loop at its level, on the jam's shared bar grid: everyone in a jam SHALL hear each loop's downbeats within 20 ms of each other. A track's loop SHALL start on the jam bar where its take began and repeat every length. A track someone else adds SHALL start playing right away, from its current point in the loop. A track the listener just recorded SHALL keep looping from where its take started, without a gap. While the master's Repeat is on, a loop SHALL play the repeated slice in its place, as audio/master says.

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

Each track SHALL play its hits snapped to its grid (off, 1/32, 1/16, 1/8 or 1/4), then swung by the jam's swing, while keeping the recorded positions. A hit snapped past the loop's end SHALL play at its start.

- **Scenario: Slightly late hit**
  - **GIVEN** a hit recorded at beat 1.06
  - **WHEN** the track plays with 1/16 quantize
  - **THEN** the hit sounds at beat 1, and the track still stores 1.06

### Requirement: Track controls

Anyone in the jam SHALL be able to mute, set the level (0 to 1.5) of, rename, change the snap of and remove any track, and turn any of its sound knobs. A name SHALL be 1 to 40 characters after trimming. Each track SHALL show its length in bars, its number of hits and its hits across the loop, and, while it plays, a playhead and a ring showing how far through the loop it is. Each track's sound knobs SHALL sit in an Effects strip under its row that can be opened and closed; the strip SHALL start closed, and its toggle SHALL stay pressed in while the strip is open, and SHALL show when any knob is away from its default. Turning a knob SHALL change the sound for everyone in the jam while it turns, as dragging the level does; a double-click SHALL reset it to its default.

- **Scenario: Mute someone's loop**
  - **WHEN** one person mutes a track another person recorded
  - **THEN** it goes silent for everyone in the jam
- **Scenario: Blank name**
  - **WHEN** someone clears a track's name
  - **THEN** the row shows an error and the track keeps its old name
- **Scenario: Turn up the reverb**
  - **GIVEN** two people in a jam with a looping track
  - **WHEN** one opens the track's Effects strip and turns its Reverb up
  - **THEN** both hear the reverb grow while the knob turns
- **Scenario: Changed loop at a glance**
  - **GIVEN** a track with Tone at -0.4 and its strip closed
  - **WHEN** someone looks at the mixer
  - **THEN** that track's Effects toggle shows a dot, and a track at the defaults shows none

### Requirement: Sound knobs

Every track SHALL play through five sound settings: reverb (0 to 1), echo (0 to 1), tone (-1 to 1), pitch (-12 to +12 whole semitones) and pan (-1 to 1), each defaulting to 0, which leaves the sound unchanged. A track without a stored setting SHALL play at that setting's default. Reverb SHALL add a room's reflections; echo SHALL repeat each hit every dotted eighth note at the jam's tempo, fading with each repeat; tone SHALL darken the sound below 0 and thin it above 0; pitch SHALL raise or lower each hit by that many semitones from the track's next hit; pan SHALL move the track between the left speaker (-1) and the right (+1). Pads played live, the count-in and the metronome SHALL stay dry of a track's sound settings.

- **Scenario: Older jam**
  - **GIVEN** a jam whose tracks were recorded before sound knobs existed
  - **WHEN** someone opens it
  - **THEN** every loop sounds as it did, and each knob reads its default
- **Scenario: An octave up**
  - **GIVEN** a looping track of the bass C
  - **WHEN** someone sets its pitch to +12
  - **THEN** from its next hit it plays an octave higher, for everyone in the jam
- **Scenario: Echo in time**
  - **GIVEN** a jam at 120 BPM and a track with one hit a bar
  - **WHEN** someone turns its echo up
  - **THEN** each hit repeats 375 ms later, quieter each time
- **Scenario: Hard left**
  - **WHEN** someone sets a track's pan to -1
  - **THEN** that track plays only from the left speaker
- **Scenario: Live pads stay dry**
  - **GIVEN** a track with reverb at 1 that hits the snare
  - **WHEN** someone plays the snare pad live
  - **THEN** the live hit sounds dry, and the track's hits keep their reverb
- **Scenario: Mute silences the tail's source**
  - **GIVEN** a track with echo at 1
  - **WHEN** someone mutes it
  - **THEN** it adds no new echoes, and echoes already sounding fade out

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
- **Scenario: Two people's clicks**
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

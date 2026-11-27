## Purpose

Let people use their voice in a jam: record it through a voice preset, as an uploaded sound or as clips sung into a take, with the effect saved into the sound.

## Requirements

### Requirement: Microphone

Recording a voice SHALL ask for the microphone the first time, and SHALL capture it with the browser's noise suppression and automatic gain on and its echo cancellation off. If the microphone is refused or missing, every voice control SHALL say so, and nothing else in the jam SHALL change.

- **Scenario: Refused**
  - **WHEN** someone presses Record in the upload dialog and refuses the microphone
  - **THEN** the dialog says the microphone is blocked and how to allow it, and pads and loops play on

### Requirement: Voice presets

Every voice recording SHALL go through one preset, chosen before recording: Clean, Auto-tune (hard), Auto-tune (natural), Robot, Chipmunk, Demon, Radio and Lofi. The default SHALL be Clean, and each browser SHALL remember the last one picked. The saved sound SHALL have the preset's effect in it, so everyone hears the same sound, and the preset SHALL NOT be changeable afterwards.

- **Scenario: Robot voice**
  - **GIVEN** the Robot preset is picked
  - **WHEN** someone records "hello" and keeps it
  - **THEN** everyone in the jam who plays the sound hears the robot "hello", with no setting to undo it

### Requirement: Auto-tune key

The auto-tune presets SHALL correct the voice to a key and scale (major or minor, any of the 12 roots) picked in the rack, default C major. Each browser SHALL remember it; it SHALL NOT be part of the jam.

- **Scenario: Snap to the scale**
  - **GIVEN** Auto-tune (hard) in A minor
  - **WHEN** someone sings a steady note between A and B flat
  - **THEN** the saved sound holds an A

### Requirement: Monitor

While recording or singing live, someone SHALL be able to hear themselves through the chosen preset, exactly as it will be saved or as others hear it, with no added delay. Monitoring SHALL be off by default, each browser SHALL remember the setting, and turning it on SHALL advise headphones.

- **Scenario: Hear the preset**
  - **GIVEN** monitoring on and Chipmunk picked
  - **WHEN** someone records
  - **THEN** they hear themselves as a chipmunk while singing, and the saved sound matches what they heard
- **Scenario: Monitor live**
  - **GIVEN** monitoring on and someone live
  - **WHEN** they sing
  - **THEN** they hear themselves at once through the preset, never a bar late

### Requirement: Record a sound

The upload dialog SHALL offer Record next to choosing a file. Recording SHALL show the input level, stop by itself at 10 seconds, and then let the person listen back, record again, or keep it with a name. A kept recording SHALL become an upload of the jam under the same rules and limits as an uploaded file.

- **Scenario: Record onto a pad**
  - **WHEN** someone opens Upload a sound… for the pad on key `Q`, records 3 seconds with Clean, and keeps it as "Hey"
  - **THEN** "Hey" is among the jam's uploads, and the pad on `Q` plays it for everyone
- **Scenario: Redo**
  - **WHEN** someone listens back to a recording and presses Record again
  - **THEN** the first recording is dropped and nothing was uploaded

### Requirement: Sing into a take

While a take is recording, holding M or the Sing button SHALL record a voice clip from press to release, through the chosen preset. The clip SHALL be placed in the take at the beat it was sung, and SHALL be cut at 10 seconds, at the loop's end, and when the take stops. Sing SHALL be disabled when no take is recording, and M SHALL do nothing while someone types in a field. The take's lane SHALL show each clip as a bar from where it starts to where it ends.

- **Scenario: Sing a phrase**
  - **GIVEN** a take recording at 100 BPM
  - **WHEN** someone holds M from beat 4 to beat 6 and sings, then stops the take after two bars
  - **THEN** the new track plays their phrase from beat 4 on every loop, for everyone
- **Scenario: Not recording**
  - **WHEN** no take is recording and someone presses M
  - **THEN** nothing is recorded and the Sing button is disabled

### Requirement: Clips save with the take

When a take with clips stops, its clips SHALL upload before the track is added, and the Deck SHALL show that the take is saving. A clip that fails to upload SHALL be left out, the track SHALL be added with the rest, and the singer SHALL be told how many clips were lost. A take left with neither pad hits nor clips SHALL add no track.

- **Scenario: One clip fails**
  - **GIVEN** a take with four pad hits and two clips
  - **WHEN** one clip's upload is refused
  - **THEN** the track is added with the four hits and one clip, and the singer is told one clip was lost

### Requirement: Clips limit

A jam SHALL hold at most 64 clips, apart from its 32 uploads. While it is full, Sing SHALL be disabled and say the jam has no room for more voice clips; removing tracks frees their clips.

- **Scenario: Full of clips**
  - **GIVEN** a jam with 64 clips
  - **WHEN** someone records a take
  - **THEN** Sing is disabled and says the jam is out of room for voice clips, and pad hits still record

### Requirement: Voice in time

A clip SHALL be placed where the singer heard the beat, correcting for the delay between their microphone, the jam's audio and their speakers as the browser reports it. The rack SHALL offer an optional test that plays a click and listens for it to measure that delay instead; each browser SHALL remember the result.

- **Scenario: Calibrated**
  - **GIVEN** a browser whose test measured 120 ms of round-trip delay
  - **WHEN** someone sings exactly with beat 2 of a take
  - **THEN** the clip starts within 20 ms of beat 2

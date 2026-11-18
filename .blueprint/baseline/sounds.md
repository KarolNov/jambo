## Purpose

The sounds a jam can use: a fixed kit made in the browser, plus samples people upload to the jam.

## Requirements

### Requirement: Fixed kit

The app SHALL offer a fixed kit of 17 one-shot sounds, each with a stable id and a name, in four groups: drums, percussion, tonal and fx. The kit SHALL be generated in the browser, and an id SHALL never be reused for a different sound.

- **Scenario: Load the kit**
  - **WHEN** audio starts in a jam
  - **THEN** every sound in the kit can be played

### Requirement: Unknown sound

A pad that refers to a sound id that is neither in the kit nor among the jam's uploads SHALL play nothing and show as empty. A pad on an upload that has not loaded yet SHALL play nothing and show the upload's name as loading.

- **Scenario: Removed sound**
  - **GIVEN** a pad whose stored sound id is not in the kit or the jam's uploads
  - **WHEN** someone plays it
  - **THEN** nothing sounds and the pad reads Empty
- **Scenario: Still loading**
  - **GIVEN** a pad on an upload this client has not loaded yet
  - **WHEN** someone plays it
  - **THEN** nothing sounds and the pad shows the upload's name as loading

### Requirement: Upload a sound

Anyone in a jam SHALL be able to upload an audio file as a new sound of the jam, with a name, and put it on a pad. The file SHALL be stored outside the board, and the board SHALL list only its name and details.

- **Scenario: Upload onto a pad**
  - **WHEN** someone picks Upload a sound… for the pad on key `Q` and chooses a 2-second MP3
  - **THEN** the sound appears in the jam's uploads, the pad on `Q` plays it, and everyone in the jam hears it on `Q` within a few seconds

### Requirement: Upload limits

An upload SHALL be at most 10 seconds long after silence is trimmed from both ends, and a jam SHALL hold at most 32 uploads. Each person SHALL be able to upload or remove at most 10 sounds a minute. Uploads SHALL be stored as mono, levelled samples.

- **Scenario: Too long**
  - **WHEN** someone picks a 15-second file with no silence
  - **THEN** nothing is uploaded and they are told samples must be 10 seconds or less
- **Scenario: Full jam**
  - **GIVEN** a jam with 32 uploads
  - **WHEN** someone uploads another
  - **THEN** it is refused and they are told the jam is full
- **Scenario: Not audio**
  - **WHEN** someone picks a file the browser cannot decode as audio
  - **THEN** nothing is uploaded and they are told it isn't a sound file

### Requirement: Uploads load for everyone

Every client in a jam SHALL load each of the jam's uploads, including ones added while it is open, and play it once loaded. An upload that fails to load for any reason other than being gone SHALL show as missing and be tried again a minute later. An upload's id SHALL never be reused, so a loaded copy is never out of date.

- **Scenario: Join later**
  - **GIVEN** a jam with a track that hits a pad on an upload
  - **WHEN** someone opens the jam
  - **THEN** they hear the track's hits on that pad once the upload has loaded
- **Scenario: Download refused for now**
  - **GIVEN** downloads are rate-limited for this client
  - **WHEN** an upload fails to load
  - **THEN** its pads show it as missing, and it loads on a later try about a minute on

### Requirement: Remove or replace an upload

An upload SHALL be removable only while no pad uses it. Replacing an upload SHALL put a new file on every pad that used it and then remove it. Replacing SHALL need room for one more upload, so it is unavailable while the jam is full.

- **Scenario: In use**
  - **GIVEN** an upload on the pad on key `W`
  - **WHEN** someone tries to remove it
  - **THEN** it is not removed and they are told which pads use it
- **Scenario: Replace**
  - **GIVEN** an upload on pads `W` and `E`, and a track that hits `W`
  - **WHEN** someone replaces it with another file
  - **THEN** `W` and `E` play the new sound for everyone, the track plays it too, and the old upload is gone
- **Scenario: Replace in a full jam**
  - **GIVEN** a jam with 32 uploads
  - **WHEN** someone opens Change sounds
  - **THEN** Replace… is disabled for every upload

### Requirement: Uploads expire

A jam's uploaded audio SHALL be deleted after 90 days in which nobody opened the jam. The board SHALL stay, and pads on deleted uploads SHALL read Empty.

- **Scenario: Abandoned jam**
  - **GIVEN** a jam with uploads that nobody has opened for 90 days
  - **WHEN** someone opens it
  - **THEN** its tracks and tempo are as they were, and pads that had uploads read Empty

### Requirement: Uploads paused

While the app's sound budget is spent, every way to upload or replace a sound SHALL be disabled, and Change sounds SHALL say why and when it may come back. Removing uploads SHALL stay possible. While downloads are paused, the board SHALL say why uploaded sounds don't load.

- **Scenario: Storage full**
  - **GIVEN** uploads are paused because storage is full
  - **WHEN** someone opens Change sounds
  - **THEN** Upload a sound… and Replace… are disabled, each pad's picker shows Uploads paused, and a notice says storage is full and removing unused uploads frees space
- **Scenario: Paused mid-upload**
  - **WHEN** an upload is refused because the budget just ran out
  - **THEN** the person is told why, and the upload controls become disabled

## Purpose

Let someone sing live into a jam, heard by everyone through their voice preset one bar after they sang it, on the beat.

## Requirements

### Requirement: Go live

Someone in a jam SHALL be able to turn their mic on to sing live and off again from a mic control beside Sing. The first time in a browser, turning it on SHALL ask them to confirm they are wearing headphones, and the browser SHALL remember the answer; until they confirm, they SHALL NOT go live. Going live SHALL use the microphone as recording does, and the mic control SHALL show while they are live.

- **Scenario: First time live**
  - **GIVEN** a browser that has never gone live
  - **WHEN** someone turns their mic on
  - **THEN** they are asked to confirm headphones, and go live only once they confirm
- **Scenario: Turn it off**
  - **GIVEN** someone live
  - **WHEN** they turn their mic off
  - **THEN** within a bar nobody hears them any more, and the browser's microphone light goes out unless a take is recording

### Requirement: One bar behind

Everyone else in the jam SHALL hear a live voice exactly one bar, at the jam's tempo, after the singer sang it against the jam as they heard it, so it lands on the same beat of the bar. A part of the voice that reaches a listener too late to play on time SHALL be left out, with a short fade instead of a click, and the rest SHALL play on time.

- **Scenario: On the beat, a bar later**
  - **GIVEN** a jam at 100 BPM and a singer whose round-trip delay was measured
  - **WHEN** they sing exactly on beat 2 of a bar
  - **THEN** every listener hears it within 30 ms of beat 2 of the next bar
- **Scenario: Slow network**
  - **WHEN** part of a phrase reaches a listener more than a bar late
  - **THEN** that part is silent for them, and the phrase carries on on time after it

### Requirement: Live through the preset

A live voice SHALL go through the singer's chosen preset and key, and SHALL sound as the same preset does in a take.

- **Scenario: Robot live**
  - **GIVEN** the Robot preset is picked
  - **WHEN** someone sings live
  - **THEN** everyone hears the robot voice

### Requirement: Live voices limit

A jam SHALL have at most 3 live voices at once. While it has 3, someone turning their mic on SHALL be told the jam is full of live voices and SHALL NOT go live. A live voice SHALL stop by itself after 1 hour, telling the singer, who can turn it straight back on.

- **Scenario: Fourth singer**
  - **GIVEN** three people live in a jam
  - **WHEN** a fourth turns their mic on
  - **THEN** they are told the jam is full of live voices, and nobody hears them
- **Scenario: Two at once for the last slot**
  - **GIVEN** two people live
  - **WHEN** two more turn their mic on at the same moment
  - **THEN** exactly one of them goes live and the other is told the jam is full
- **Scenario: An hour live**
  - **WHEN** someone has been live for an hour
  - **THEN** their live voice stops, they are told why, and they can turn it on again

### Requirement: Mute a live voice

Each listener SHALL be able to mute and unmute any live voice for themselves only, from Who's here. Muting SHALL NOT change what anyone else hears.

- **Scenario: Mute for me**
  - **GIVEN** Misty Yak live and two listeners
  - **WHEN** one listener mutes Misty Yak
  - **THEN** they stop hearing Misty Yak, and the other listener still hears them

### Requirement: Dropping out

When a singer's connection drops, their live voice SHALL end for everyone and its slot SHALL be free again within a few seconds; when they come back they SHALL NOT be live until they turn their mic on again. A listener whose connection comes back SHALL hear live voices again from their next on-time part.

- **Scenario: Singer drops**
  - **GIVEN** someone live
  - **WHEN** their connection drops
  - **THEN** nobody hears them within a few seconds, the slot is free, and on reconnecting their mic control is off

### Requirement: Unsupported browser

A browser that can't encode a live voice SHALL disable the mic control and say this browser can't sing live; one that can't play live voices SHALL say so in Who's here. Where live voice isn't set up, the mic control SHALL be disabled and say live voice isn't available here.

- **Scenario: Can't encode**
  - **WHEN** someone opens a jam in a browser without live voice encoding
  - **THEN** the mic control is disabled and says this browser can't sing live, and they still hear others live
- **Scenario: Not set up here**
  - **WHEN** someone opens a jam served without live voice set up
  - **THEN** the mic control is disabled and says live voice isn't available here

### Requirement: Sing a take while live

While someone is live and a take of theirs is recording, holding M or Sing SHALL record clips into the take exactly as audio/voice says, and they SHALL stay live throughout.

- **Scenario: Keep a phrase**
  - **GIVEN** someone live with a take recording
  - **WHEN** they hold M from beat 4 to beat 6
  - **THEN** the take gets that phrase as a clip at beat 4, and listeners hear it live a bar later too

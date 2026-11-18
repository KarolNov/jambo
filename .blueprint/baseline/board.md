## Purpose

The jam page: shows a board's shared contents, who you are in it and whether you are connected, and writes to it only through validated changes.

## Requirements

### Requirement: Validated writes

A write to the board SHALL go through the board's operations, each validated against the board's schema; an invalid operation SHALL change nothing, and the other operations in the same batch SHALL still apply.

- **Scenario: One bad operation in a batch**
  - **WHEN** a batch adds a track and sets another track's gain to -1
  - **THEN** the track is added, the gain is unchanged, and the caller gets the issue for the gain operation

### Requirement: Unreadable data

The board SHALL show only the parts of the board that pass its schema; a pad or track that doesn't SHALL be left out, and an unreadable tempo SHALL read as the default.

- **Scenario: Malformed track in the doc**
  - **GIVEN** a jam whose stored board holds one valid track and one with no hits
  - **WHEN** someone opens it
  - **THEN** only the valid track shows and plays

### Requirement: Connection status

The board SHALL show whether it is live, connecting or offline, and stay editable while offline.

- **Scenario: Server unreachable**
  - **WHEN** the connection drops
  - **THEN** the board says it is offline and that edits will sync when back, and stays editable

### Requirement: Your identity

Each browser SHALL have an anonymous identity, an id and one of eight named colours, kept across visits, and the board SHALL show its colour name.

- **Scenario: Come back**
  - **WHEN** someone opens a jam, closes the tab and opens another jam in the same browser
  - **THEN** the board shows the same colour both times
- **Scenario: Storage blocked**
  - **WHEN** the browser blocks local storage
  - **THEN** the board still opens with a fresh identity for that page

### Requirement: Share the jam

The board SHALL show the jam's slug and a control that copies the jam's link, confirming the copy for a moment, and a logo that starts a new jam.

- **Scenario: Copy link**
  - **WHEN** someone presses Copy link
  - **THEN** the jam's URL is on their clipboard and the button reads "Link copied" briefly

### Requirement: Who's here

The board SHALL list everyone connected to the jam, one entry per identity, each as their colour and colour name, with this person first and marked as you.

- **Scenario: Someone joins**
  - **GIVEN** one person in a jam
  - **WHEN** a second person, in another browser, opens it
  - **THEN** both boards list both people within a couple of seconds
- **Scenario: Two tabs**
  - **WHEN** someone opens the same jam in two tabs of one browser
  - **THEN** others see them listed once
- **Scenario: Someone leaves**
  - **WHEN** a person closes the jam
  - **THEN** they disappear from everyone else's list within a few seconds, or within about 30 seconds if their connection dropped

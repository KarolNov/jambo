## Purpose

Keep each jam's board document in sync between everyone who has it open, and keep it when they leave.

## Requirements

### Requirement: Live sync

Edits made by one person in a jam SHALL appear for everyone else in that jam without a reload.

- **Scenario: Two people edit**
  - **GIVEN** two browsers open the same jam
  - **WHEN** one adds a track
  - **THEN** the other shows it within a second, and concurrent edits by both are both kept

### Requirement: Board persists

A jam's board SHALL be saved within a few seconds of an edit and when the last person leaves, and be the same when someone opens the link again.

- **Scenario: Come back later**
  - **GIVEN** a jam with three tracks and nobody connected
  - **WHEN** someone opens its link the next day
  - **THEN** they see the same three tracks
- **Scenario: Server restart**
  - **GIVEN** a jam whose board was saved
  - **WHEN** the server holding it restarts
  - **THEN** the next person to open the link sees the saved board

### Requirement: Board defaults

Whenever a jam's board is opened, it SHALL get the default tempo if it has no valid tempo, and the default pad layout if it has no pads, leaving everything already set alone.

- **Scenario: First open**
  - **WHEN** the first person opens a new jam
  - **THEN** everyone who joins sees the same tempo of 100 BPM and the same 16 pads
- **Scenario: Existing jam**
  - **GIVEN** a jam whose tempo is 120 and whose pads were reassigned
  - **WHEN** someone opens it again
  - **THEN** the tempo and pads are unchanged

### Requirement: Jams are isolated

Edits in one jam SHALL never appear in another.

- **Scenario: Two jams**
  - **WHEN** a track is added in jam A
  - **THEN** jam B does not change

### Requirement: Board connections only

The board endpoint SHALL accept only live connections to the board of a well-formed jam; anything else SHALL get not found.

- **Scenario: Plain request**
  - **WHEN** someone sends an ordinary HTTP request to a jam's board, or connects to anything other than a board
  - **THEN** they get not found

### Requirement: Reconnect

A client that loses its connection SHALL keep its local edits and merge them when it reconnects.

- **Scenario: Offline for a moment**
  - **GIVEN** a connected client
  - **WHEN** its connection drops, it renames a track, and the connection comes back
  - **THEN** the rename reaches the others, and their edits made meanwhile reach it

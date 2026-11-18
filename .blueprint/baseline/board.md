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
  - **THEN** the board says it is offline, its tooltip says edits will sync when back, and it stays editable

### Requirement: Your identity

Each browser SHALL have an anonymous identity, an id and one of eight named colours, kept across visits, and the board SHALL show its colour, named while three or fewer people are here and in a tooltip after that.

- **Scenario: Come back**
  - **WHEN** someone opens a jam, closes the tab and opens another jam in the same browser
  - **THEN** the board shows the same colour both times
- **Scenario: Storage blocked**
  - **WHEN** the browser blocks local storage
  - **THEN** the board still opens with a fresh identity for that page

### Requirement: Share the jam

The board SHALL show the jam's slug, a logo that starts a new jam, and a control that shares the jam's link, without query string or hash: through the system share sheet where the browser has one, otherwise (or if the sheet fails) by copying it. Closing the share sheet SHALL count as cancelled, not a failure. The control SHALL say for a moment when the link was copied, or that it couldn't be.

- **Scenario: Copy link**
  - **GIVEN** a browser with no share sheet
  - **WHEN** someone presses Share this jam
  - **THEN** the jam's URL is on their clipboard and the control says "Link copied" briefly
- **Scenario: Copy fails**
  - **WHEN** the browser refuses the clipboard
  - **THEN** the control says "Couldn't copy the link"
- **Scenario: Share sheet**
  - **WHEN** someone presses Share this jam on a phone
  - **THEN** the system share sheet opens with the jam's link

### Requirement: Who's here

The board SHALL list everyone connected to the jam, one entry per identity, each as a dot in their colour, with this person first and marked as you. While three or fewer people are here each dot SHALL carry its colour name; past three, only the dots, each naming its person in a tooltip.

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
- **Scenario: Crowded jam**
  - **GIVEN** four people in a jam
  - **WHEN** one of them looks at who's here
  - **THEN** they see four dots, each naming its person on hover

### Requirement: Theme

Every page SHALL come in a light and a dark theme. It SHALL follow the system's setting until someone picks one with the theme switch; the pick SHALL then be remembered in this browser across visits. Collaborator colours SHALL be painted per theme with at least 3:1 contrast against the surface, and text with at least 4.5:1.

- **Scenario: First visit**
  - **GIVEN** a browser that never picked a theme, with the system in dark mode
  - **WHEN** someone opens a jam
  - **THEN** it shows the dark theme
- **Scenario: Pick a theme**
  - **WHEN** someone switches to light and opens a jam again the next day
  - **THEN** it shows the light theme
- **Scenario: Storage blocked**
  - **WHEN** the browser blocks local storage and someone flips the switch
  - **THEN** this page switches theme

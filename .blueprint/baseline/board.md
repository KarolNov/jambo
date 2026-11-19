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

The board SHALL show whether it is live, connecting for the first time, reconnecting after losing its connection, or offline because the browser has no network, each with its own light, and stay editable in all of them.

- **Scenario: Connection drops**
  - **GIVEN** a connected board
  - **WHEN** the server becomes unreachable
  - **THEN** the board says it is reconnecting, its tooltip says edits will sync when it is back, and it stays editable
- **Scenario: No network**
  - **WHEN** the browser loses its network
  - **THEN** the board says it is offline, its tooltip says edits will sync when back, and it stays editable

### Requirement: Your identity

Each browser SHALL have an anonymous identity: an id, a key only it and the room know, and a usual name and colour, kept across visits. A name SHALL be a fun adjective and an animal, like Groovy Otter; a colour, one of eight. In a jam, a person SHALL have the name and colour the room seats them with, and their usual ones until it answers or while offline. On joining they SHALL ask the room for their usual ones; on reconnecting, for the ones they have. The board SHALL show their name and colour.

- **Scenario: Come back**
  - **GIVEN** nobody else in either jam has their usual name or colour
  - **WHEN** someone opens a jam, closes the tab and opens another jam in the same browser
  - **THEN** the board shows the same name and colour both times
- **Scenario: Same usual name and colour**
  - **WHEN** two people whose usual name is Groovy Otter and usual colour is Sky open one jam
  - **THEN** they show with different names and different colours, on both boards
- **Scenario: Connection blip**
  - **GIVEN** someone seated as Sunny Puffin because another person has their usual name
  - **WHEN** their connection drops and comes back
  - **THEN** they are still Sunny Puffin
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

The board SHALL list everyone connected to the jam and every agent present, one entry per identity, each as a dot in their colour, with this person first and marked as you, and each agent's dot with a glow, and its name with a superscript AI in its colour. Others SHALL list a person only once the room has seated them, so nobody is shown with a name or colour someone else holds. While three or fewer are here each dot SHALL carry its name; past three, only the dots, each naming its person or agent in a tooltip. A client older than names SHALL show by its colour name. Agents SHALL come only from the room's list: a browser SHALL NOT be able to show one.

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
- **Scenario: An agent joins**
  - **WHEN** Groovy Claude acts in the jam
  - **THEN** everyone's list shows Groovy Claude with a superscript AI and a glowing dot
- **Scenario: Browser posing as an agent**
  - **WHEN** a browser announces itself with an agent's id or lists agents in its own presence
  - **THEN** nobody's list shows them as an agent

### Requirement: Who's turning a control

While someone drags a loop's level or one of its sound knobs, everyone else in the jam SHALL see that control ringed in their colour with their name beside it, until they let go, cancel, or the control goes away. It SHALL NOT stop anyone else from moving the control, and someone's other tabs SHALL NOT show them as turning it.

- **Scenario: Someone turns the reverb**
  - **GIVEN** two people in a jam with a loop's Effects strip open
  - **WHEN** Misty Yak drags the loop's Reverb knob
  - **THEN** the other person sees that knob ringed in Misty Yak's colour with Misty Yak's name above it, and its value moving
- **Scenario: Let go**
  - **WHEN** Misty Yak lets go, presses Escape, or closes the strip mid-drag
  - **THEN** the ring and name disappear for everyone
- **Scenario: Both at once**
  - **GIVEN** Misty Yak dragging a loop's level
  - **WHEN** someone else drags it too
  - **THEN** they can, and they see Misty Yak's ring while they do

### Requirement: Agent work marked

A loop an agent added SHALL show a superscript AI in the loop's colour after its name wherever loops are listed, and a sound an agent uploaded SHALL name the agent as its uploader.

- **Scenario: Agent beat**
  - **WHEN** an agent adds a loop
  - **THEN** its row shows the AI mark, and loops people recorded do not
- **Scenario: Agent upload**
  - **WHEN** Groovy Claude uploads Vox
  - **THEN** the dot beside Vox says "Uploaded by Groovy Claude"

### Requirement: Focus in your colour

While someone is in a jam, keyboard focus rings, hover highlights and lit controls that take the theme's accent SHALL show in their collaborator colour; outside a jam, in the theme's accent.

- **Scenario: Tab through controls**
  - **GIVEN** someone seated in the jam as Sky
  - **WHEN** they tab to the tempo field
  - **THEN** its focus ring is Sky
- **Scenario: Hover and switches**
  - **GIVEN** someone seated as Amber with the metronome on
  - **WHEN** they point at Change sounds
  - **THEN** its label and the metronome's lit I are Amber
- **Scenario: Leave the jam**
  - **WHEN** they leave the jam page
  - **THEN** focus rings and highlights show in the theme's accent again

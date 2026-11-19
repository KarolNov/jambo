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

### Requirement: Jam clock source

The room SHALL answer each client's clock request with its current time, so every client in a jam can agree one clock.

- **Scenario: Clock request**
  - **WHEN** a connected client sends a clock request
  - **THEN** the room answers that client alone with the request's own timestamp and the room's current time

### Requirement: Presence relay

The room SHALL pass each client's presence to everyone else in the jam, and SHALL drop a client's presence when it disconnects.

- **Scenario: Leave**
  - **GIVEN** two clients in a jam
  - **WHEN** one closes its connection
  - **THEN** the other stops seeing its presence within a few seconds

### Requirement: Agent presence

The room SHALL publish the agents present in its jam, each with its public id, name, colour and latest summary, to everyone connected, and SHALL remove an agent 5 minutes after its last action even with nobody connected.

- **Scenario: Late joiner**
  - **GIVEN** an agent present in a jam
  - **WHEN** a person opens the jam
  - **THEN** they see the agent in Who's here

### Requirement: Seats

The room SHALL give each person and each agent in a jam a name nobody else there has, and a colour nobody else there has while one of the eight is free. It SHALL know a person by a key private to their browser, and an agent by a key private to it, never by the id others in the jam can see. A person SHALL get the name and colour they already have in another tab. Otherwise they SHALL get the name they ask for if nobody here has it, else a fresh adjective and animal nobody here has, comparing names without case; and the colour they ask for if it is free, else the first free one, and past eight people the least used colour. An agent's name SHALL be an adjective and its kind, a fresh adjective when the name it asks for is taken or isn't of that form, and its colour SHALL be chosen as a person's is. Names and colours SHALL be free again once everyone holding them has left, and an agent's once it leaves or idles out.

- **Scenario: Shared usual name and colour**
  - **GIVEN** three people who ask for Groovy Otter and Sky
  - **WHEN** they join one jam, one after another
  - **THEN** they get Sky, Teal and Coral, the first stays Groovy Otter, and all three names differ
- **Scenario: Second tab**
  - **WHEN** a person opens the jam in a second tab
  - **THEN** it gets the name and colour they already have
- **Scenario: Someone leaves**
  - **GIVEN** Groovy Otter in Sky has left the jam
  - **WHEN** someone asking for Groovy Otter and Sky joins
  - **THEN** they get Groovy Otter and Sky
- **Scenario: Someone else's id**
  - **GIVEN** Groovy Otter in Sky is in the jam
  - **WHEN** another person asks for a seat using Groovy Otter's id
  - **THEN** they get a name and colour of their own
- **Scenario: Nine people**
  - **GIVEN** eight people in a jam, one per colour
  - **WHEN** a ninth joins
  - **THEN** they get the least used colour, the one they asked for on a tie, and a name nobody else there has
- **Scenario: Agent holds a colour**
  - **GIVEN** Groovy Claude in Sky in a jam
  - **WHEN** a person whose usual colour is Sky joins
  - **THEN** they get another colour
- **Scenario: Agent idles out**
  - **GIVEN** Groovy Claude in Sky, idle for 5 minutes
  - **WHEN** a person whose usual colour is Sky joins
  - **THEN** they get Sky

### Requirement: Sound storage

The room SHALL store each upload's audio outside the board, list it on the board only after the audio is stored, serve it to anyone with the jam's link, and delete it after its listing is removed or the jam goes 90 days with nobody opening it and no agent acting in it. Served files SHALL be cacheable for a day, so a deleted file stops being served within a day. It SHALL refuse bodies over 900,000 bytes, anything other than 10 s or less of mono 16-bit 44.1 kHz WAV, more than 10 writes per minute from one address, more than 120 downloads that miss the edge cache per minute from one address, and uploads while it is deleting the jam's expired audio.

- **Scenario: Serve**
  - **WHEN** a client requests a listed upload
  - **THEN** it gets the WAV, marked cacheable for a day
- **Scenario: Bad file**
  - **WHEN** someone posts a file that isn't a valid WAV of the right format
  - **THEN** it is refused and nothing is stored or listed
- **Scenario: Too many writes**
  - **WHEN** one address uploads an 11th sound within a minute
  - **THEN** it is refused with "too many requests"
- **Scenario: Too many downloads**
  - **WHEN** one address makes a 121st download that misses the edge cache within a minute
  - **THEN** it is refused with "too many downloads"
- **Scenario: An agent keeps the sounds**
  - **GIVEN** a jam nobody has opened for 89 days
  - **WHEN** an agent runs operations in it
  - **THEN** its uploads are kept for another 90 days
- **Scenario: Clearing old sounds**
  - **GIVEN** the room is deleting a jam's audio after 90 days unvisited
  - **WHEN** someone uploads a sound to that jam
  - **THEN** it is refused, nothing is stored or listed, and they are told to try again in a moment

### Requirement: Sound budget

Uploaded sounds SHALL use at most a fixed share of R2's monthly free tier (10 GB-month stored, 1 million writes, 10 million reads), counted across all jams: 24% in production and 0.1% in each preview, so production and up to ten previews stay under 25%. Uploads SHALL be refused while storage could not fit one more upload or 90% of the month's write budget is used (the rest stays for retention). Downloads that miss the edge cache SHALL be refused once the month's read budget is used. Removing uploads SHALL always be allowed, and SHALL give its storage back. Write and read budgets SHALL start again each calendar month (UTC).

- **Scenario: Storage full**
  - **GIVEN** stored sounds within one upload of the storage budget
  - **WHEN** someone uploads a sound
  - **THEN** it is refused, nothing is stored, and they are told uploads are paused because storage is full
- **Scenario: Reads spent**
  - **GIVEN** this month's read budget is used
  - **WHEN** a client requests an upload that isn't in the edge cache
  - **THEN** it is refused, and a cached upload is still served
- **Scenario: New month**
  - **GIVEN** last month's write budget was used up
  - **WHEN** a new month starts
  - **THEN** uploads are open again, and stored bytes still count

## Purpose

Let an AI agent with a jam's link take part in the jam over MCP: be seen there, read the board, and change it by sending board operations.

## Requirements

### Requirement: MCP endpoint

jambo SHALL serve an MCP server at `/mcp` offering the tools `join`, `run`, `upload_sound`, `listen` and `leave`, each taking a jam link or slug, with no sign-in. A malformed jam SHALL be refused. A link to a jam on another host SHALL be refused, naming the MCP server to add for it.

- **Scenario: Link as key**
  - **GIVEN** an agent connected to `/mcp`
  - **WHEN** it calls `run` with a jam's full URL
  - **THEN** the run acts on that jam
- **Scenario: Bad jam**
  - **WHEN** an agent calls `join` with `not a jam`
  - **THEN** it is refused and no jam changes
- **Scenario: Link on another host**
  - **GIVEN** an agent connected to the MCP server on `jambo.test`
  - **WHEN** it calls `join` with a jam link on `jambo.example`
  - **THEN** it is refused with a message to add `https://jambo.example/mcp`, and no jam changes

### Requirement: Describes itself

The MCP server SHALL describe, in its instructions and tool schemas, the jam an agent reads and every operation it can send.

- **Scenario: Client without the skill**
  - **WHEN** an MCP client connects
  - **THEN** its instructions name every jam field, and the `run` tool's schema every operation

### Requirement: Agent identity

Every tool SHALL accept an optional agent key, kind, usual name and usual colour, and `join`, `run` and `upload_sound` SHALL return the agent's key, name and colour; without a key, a new agent SHALL be made. A key jambo didn't make, a kind that isn't one word of 1 to 20 letters or digits, or a colour that isn't one of the eight SHALL be refused. The key SHALL be private to the agent: the board and presence SHALL show only a separate public id, the same in a jam for the same key and different from one jam to the next. An agent's name SHALL be an adjective followed by its kind (default Agent), like Groovy Claude. The room SHALL seat an agent as it seats people: its usual name if it has that form and nobody here has it, else a fresh adjective with the same kind that nobody here has, comparing names without case; its usual colour if free, else the first free one, and past eight the least used. While present, an agent SHALL take a kind, name or colour it passes when nobody else here has it, and keep its own otherwise; a new kind its name doesn't fit SHALL get it a fresh name of that kind.

- **Scenario: First action**
  - **WHEN** an agent calls `run` with no agent key and the kind Claude
  - **THEN** it gets back a new agent key and a name like Groovy Claude, and later calls with that key act as the same agent
- **Scenario: Key stays private**
  - **GIVEN** Groovy Claude has added a loop
  - **WHEN** someone reads the loop's author and the jam's presence
  - **THEN** neither holds the agent's key
- **Scenario: Two Claudes**
  - **GIVEN** Groovy Claude in a jam
  - **WHEN** another agent asks for the name Groovy Claude
  - **THEN** it gets another adjective with Claude, like Mellow Claude
- **Scenario: Person-style name**
  - **WHEN** an agent of kind Claude asks for the name Groovy Otter
  - **THEN** it gets a name ending in Claude
- **Scenario: Rename while here**
  - **GIVEN** Twangy Claude in a jam with Groovy Claude
  - **WHEN** it calls `run` asking for Funky Claude and amber, then for Groovy Claude
  - **THEN** it becomes Funky Claude in amber, and stays Funky Claude

### Requirement: Returning agent keeps its identity

An agent that comes back with its key after it left or idled out SHALL be seated asking for the kind, name and colour it had when it left, unless it passes others, for up to 7 days after it left. It SHALL get each of them only while nobody here has it. A jam SHALL remember at most 64 agents that left, forgetting the longest gone first. It SHALL store no agent key for this.

- **Scenario: Back after idling out**
  - **GIVEN** Funky Claude in amber idled out of a jam
  - **WHEN** it calls `run` with its key and no name or colour
  - **THEN** it is Funky Claude in amber again, with the same public id
- **Scenario: Name taken meanwhile**
  - **GIVEN** Funky Claude left, and another agent then took the name Funky Claude
  - **WHEN** Funky Claude comes back with its key
  - **THEN** it gets the same public id under another adjective with Claude
- **Scenario: Gone too long**
  - **GIVEN** an agent left a jam more than 7 days ago
  - **WHEN** it comes back with its key and no kind or name
  - **THEN** it is seated as a new agent of kind Agent, with the same public id

### Requirement: Presence follows activity

An agent SHALL be in the jam's presence from its first action (`join`, `run`, `upload_sound` or `listen`) until it calls `leave` or goes 5 minutes without an action; each action SHALL renew it.

- **Scenario: Auto join**
  - **GIVEN** an agent not in the jam
  - **WHEN** it calls `run`
  - **THEN** everyone in the jam sees it in Who's here within a couple of seconds
- **Scenario: Idle**
  - **GIVEN** an agent in the jam
  - **WHEN** 5 minutes pass without it acting
  - **THEN** it disappears from Who's here
- **Scenario: Leave**
  - **WHEN** an agent calls `leave`
  - **THEN** it disappears from Who's here within a few seconds

### Requirement: Reads the jam

`join` SHALL return the jam as it is: tempo, pads, the kit and the jam's uploads and clips, each sound with its kind, readable tracks with each hit naming a pad or a sound, the master knobs and touchpad modes, each mode as its x and y, and who's here.

- **Scenario: Read tracks**
  - **GIVEN** a jam with two tracks
  - **WHEN** an agent calls `join`
  - **THEN** it gets both tracks
- **Scenario: Read the master**
  - **GIVEN** a jam with Filter latched at x -0.4 and swing at 0.5
  - **WHEN** an agent calls `join`
  - **THEN** it gets Filter at x -0.4, y 0 and swing 0.5, with every other master setting at its default
- **Scenario: Read a voice track**
  - **GIVEN** a track with a pad hit and a clip hit
  - **WHEN** an agent calls `join`
  - **THEN** the track's hits hold one `padId` hit and one `soundId` hit, and the sounds list that clip with kind `clip`

### Requirement: Listens for changes

`listen` SHALL need the agent's key, and SHALL wait up to 25 seconds (20 by default) for the jam to change. It SHALL then answer what changed since that agent last looked, leaving out what its own runs changed: the tempo, pads, sounds added or removed, tracks added, removed or changed (with only the changed fields), master settings, and who joined or left. It SHALL also answer who is holding which control right now. Once something changes, it SHALL wait about three quarters of a second for more before answering, and SHALL never answer sooner than 3 seconds after its last answer to that agent. With no record of what the agent last saw, it SHALL answer the board too.

- **Scenario: Hear a person**
  - **GIVEN** an agent that set swing and is listening
  - **WHEN** a person sets drive to 0.6
  - **THEN** listen answers master drive 0.6, without the swing
- **Scenario: Someone holding**
  - **GIVEN** Misty Yak dragging master tone
  - **WHEN** an agent listens
  - **THEN** it hears that Misty Yak is holding `master.tone`
- **Scenario: Quiet jam**
  - **WHEN** nothing changes during the whole wait
  - **THEN** listen answers no changes, with who is holding what
- **Scenario: No record**
  - **GIVEN** an agent whose last look the jam doesn't remember
  - **WHEN** it listens
  - **THEN** it gets the board too

### Requirement: One run, one change

A run SHALL be a list of board operations, applied in order to the jam as one change tagged as made by an AI; the agent SHALL get one result per operation, with the issues of any refused one. Refused operations SHALL change nothing; the rest SHALL still apply. A track a run adds MAY carry a ref, starting `new:`, that later operations in the same run use as its id. A ref used twice in a run, or naming a track not added earlier in it, SHALL be refused.

- **Scenario: Beat with one bad op**
  - **WHEN** a run assigns a pad, adds a track and sets the level of a track that does not exist
  - **THEN** everyone sees the pad and the track appear together, and the agent gets two successes and one issue
- **Scenario: Malformed run**
  - **WHEN** a run holds an operation agents can't make, like `expireSounds`, or one of the wrong shape
  - **THEN** the whole run is refused and nothing is applied

### Requirement: Agent writes carry the agent

A track an agent adds SHALL have the agent as its author and the agent's colour, start unmuted with no effects, and get its id from jambo; the agent SHALL give only its name, bars, hits (each naming a pad or a listed sound), level and snap, and optionally its reverb, echo, tone, pitch and pan.

- **Scenario: Posing as someone**
  - **WHEN** a run adds a track giving another person's id as author and their colour
  - **THEN** the track is added with the agent as author and in the agent's colour
- **Scenario: Track with echo**
  - **WHEN** a run adds a track with echo 0.4 and pan 0.5
  - **THEN** the track is added with that echo and pan, and plays them for everyone
- **Scenario: Reuse a voice**
  - **GIVEN** a jam with a clip named by one track
  - **WHEN** a run adds a track with hits naming that clip on beats 0 and 8
  - **THEN** the track is added and plays the clip twice per loop for everyone

### Requirement: Same powers as a person

A run SHALL be able to set the tempo, assign pads, replace a sound, add, change and remove any track, set the master knobs, and set or reset any touchpad mode, under the same rules as a person. It SHALL NOT be able to add, remove or expire uploads. An operation on a control a person is holding right now SHALL be refused with an issue naming them; the run's other operations SHALL still apply.

- **Scenario: Remove someone's track**
  - **GIVEN** a track a person recorded
  - **WHEN** a run removes it
  - **THEN** it is removed for everyone
- **Scenario: Agent drops the filter**
  - **WHEN** a run sets Filter to x -0.8, y 0.3
  - **THEN** everyone hears the mix darken, and Filter stays there until someone moves or resets it
- **Scenario: Held control**
  - **GIVEN** Misty Yak dragging master tone
  - **WHEN** a run sets master tone and swing
  - **THEN** tone is refused with an issue saying Misty Yak is holding it, and swing changes

### Requirement: Run limits

A run SHALL be refused, with nothing applied, if it holds no operations or more than 64. Each run SHALL need a summary of 1 to 140 characters, returned with its results and kept as the agent's latest summary in its presence.

- **Scenario: Too many operations**
  - **WHEN** a run holds 65 operations
  - **THEN** it is refused and the jam is unchanged
- **Scenario: No summary**
  - **WHEN** a run has an empty summary
  - **THEN** it is refused and the jam is unchanged

### Requirement: Agent seats

A jam SHALL seat at most 8 agents, and at most 3 from one client address; a new agent past either limit SHALL be refused, telling it to pass its agent key. An agent already present SHALL always get back in with its key.

- **Scenario: Fourth from one address**
  - **GIVEN** three agents from one address in a jam
  - **WHEN** a fourth call from that address comes without a key
  - **THEN** it is refused, and a call with one of the three keys still gets in

### Requirement: Agent rate limit

Tool calls other than `listen` SHALL be refused once one client address makes more than 20 in a minute.

- **Scenario: 21st call**
  - **WHEN** one address makes a 21st tool call within a minute
  - **THEN** it is refused with "too many requests" and nothing changes
- **Scenario: Listen past the limit**
  - **GIVEN** an address that made 21 calls within a minute
  - **WHEN** its agent calls `listen`
  - **THEN** it gets an answer

### Requirement: Agent uploads

`upload_sound` SHALL take a WAV with a name and upload it to the jam under the same rules, limits and budget as an upload from the browser, with the agent as author, under its name and in its colour. The WAV MAY carry other chunks, such as LIST, and come as standard or URL-safe base64; jambo SHALL keep only its audio.

- **Scenario: Upload**
  - **WHEN** an agent uploads a 2-second mono 16-bit 44.1 kHz WAV named "Vox"
  - **THEN** the jam lists "Vox" by the agent, and a run can assign it to a pad
- **Scenario: Wrong format**
  - **WHEN** an agent uploads a stereo WAV
  - **THEN** it is refused and nothing is stored or listed
- **Scenario: WAV from ffmpeg**
  - **WHEN** an agent uploads a mono WAV with a LIST chunk
  - **THEN** it is listed

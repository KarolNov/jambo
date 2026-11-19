## Purpose

Let an AI agent with a jam's link take part in the jam over MCP: be seen there, read the board, and change it by sending board operations.

## Requirements

### Requirement: MCP endpoint

jambo SHALL serve an MCP server at `/mcp` offering the tools `join`, `run`, `upload_sound` and `leave`, each taking a jam link or slug, with no sign-in. A malformed jam SHALL be refused.

- **Scenario: Link as key**
  - **GIVEN** an agent connected to `/mcp`
  - **WHEN** it calls `run` with a jam's full URL
  - **THEN** the run acts on that jam
- **Scenario: Bad jam**
  - **WHEN** an agent calls `join` with `not a jam`
  - **THEN** it is refused and no jam changes

### Requirement: Describes itself

The MCP server SHALL describe, in its instructions and tool schemas, the jam an agent reads and every operation it can send.

- **Scenario: Client without the skill**
  - **WHEN** an MCP client connects
  - **THEN** its instructions name every jam field, and the `run` tool's schema every operation

### Requirement: Agent identity

Every tool SHALL accept an optional agent key, kind, usual name and usual colour, and return the agent's key, name and colour; without a key, a new agent SHALL be made. The key SHALL be private to the agent: the board and presence SHALL show only a separate public id. An agent's name SHALL be an adjective followed by its kind (default Agent), like Groovy Claude. The room SHALL seat an agent as it seats people: its usual name if it has that form and nobody here has it, else a fresh adjective with the same kind that nobody here has, comparing names without case; its usual colour if free, else the first free one, and past eight the least used.

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

### Requirement: Presence follows activity

An agent SHALL be in the jam's presence from its first action (`join`, `run` or `upload_sound`) until it calls `leave` or goes 5 minutes without an action; each action SHALL renew it.

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

`join` SHALL return the jam as it is: tempo, pads, the kit and the jam's uploads, readable tracks, and who's here.

- **Scenario: Read tracks**
  - **GIVEN** a jam with two tracks
  - **WHEN** an agent calls `join`
  - **THEN** it gets both tracks

### Requirement: One run, one change

A run SHALL be a list of board operations, applied in order to the jam as one change tagged as made by an AI; the agent SHALL get one result per operation, with the issues of any refused one. Refused operations SHALL change nothing; the rest SHALL still apply. A track a run adds MAY carry a ref, starting `new:`, that later operations in the same run use as its id.

- **Scenario: Beat with one bad op**
  - **WHEN** a run assigns a pad, adds a track and sets the level of a track that does not exist
  - **THEN** everyone sees the pad and the track appear together, and the agent gets two successes and one issue
- **Scenario: Malformed run**
  - **WHEN** a run holds an operation agents can't make, like `expireSounds`, or one of the wrong shape
  - **THEN** the whole run is refused and nothing is applied

### Requirement: Agent writes carry the agent

A track an agent adds SHALL have the agent as its author and the agent's colour, start unmuted with no effects, and get its id from jambo; the agent SHALL give only its name, bars, hits, level and snap.

- **Scenario: Posing as someone**
  - **WHEN** a run adds a track giving another person's id as author and their colour
  - **THEN** the track is added with the agent as author and in the agent's colour

### Requirement: Same powers as a person

A run SHALL be able to set the tempo, assign pads, replace a sound, and add, change and remove any track, under the same rules as a person; it SHALL NOT be able to add, remove or expire uploads.

- **Scenario: Remove someone's track**
  - **GIVEN** a track a person recorded
  - **WHEN** a run removes it
  - **THEN** it is removed for everyone

### Requirement: Run limits

A run SHALL be refused, with nothing applied, if it holds no operations or more than 64. Each run SHALL need a summary of 1 to 140 characters, returned with its results and kept as the agent's latest summary in its presence.

- **Scenario: Too many operations**
  - **WHEN** a run holds 65 operations
  - **THEN** it is refused and the jam is unchanged
- **Scenario: No summary**
  - **WHEN** a run has an empty summary
  - **THEN** it is refused and the jam is unchanged

### Requirement: Agent rate limit

Tool calls SHALL be refused once one client address makes more than 20 in a minute.

- **Scenario: 21st call**
  - **WHEN** one address makes a 21st tool call within a minute
  - **THEN** it is refused with "too many requests" and nothing changes

### Requirement: Agent uploads

`upload_sound` SHALL take a WAV with a name and upload it to the jam under the same rules, limits and budget as an upload from the browser, with the agent as author, under its name and in its colour.

- **Scenario: Upload**
  - **WHEN** an agent uploads a 2-second mono 16-bit 44.1 kHz WAV named "Vox"
  - **THEN** the jam lists "Vox" by the agent, and a run can assign it to a pad
- **Scenario: Wrong format**
  - **WHEN** an agent uploads a stereo WAV
  - **THEN** it is refused and nothing is stored or listed

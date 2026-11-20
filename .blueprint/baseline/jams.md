## Purpose

Give every board a shareable link that is the only thing needed to open and edit it.

## Requirements

### Requirement: New jam

Opening the app's root SHALL create a new jam and take the visitor to its link, replacing the root in their history.

- **Scenario: Visit the root**
  - **WHEN** someone opens `/`
  - **THEN** they land on `/jam/<slug>` for a new slug, showing a fresh board with the default tempo and pads
- **Scenario: Server unavailable**
  - **WHEN** someone opens `/` and the jam can't be created
  - **THEN** the page says it could not start a jam and to try again in a moment

<callout icon="❓" color="yellow_bg">
Verify: new slugs are random (32 bits) and never checked against existing jams, so a fresh slug is unused only with high probability. Is that enough?
</callout>

### Requirement: Jam link format

A jam slug SHALL be an adjective and a noun from the app's word lists and a 4-character suffix of digits and lowercase letters other than `i`, `l`, `o` and `u`, joined with hyphens.

- **Scenario: Generated slug**
  - **WHEN** a new jam is created
  - **THEN** its slug looks like `funky-otter-k7q2`, and two new jams in a row get different slugs

### Requirement: Open by link

Any well-formed jam link SHALL open that jam's board, creating a fresh board the first time it is opened.

- **Scenario: Unused but well-formed link**
  - **WHEN** someone opens `/jam/mellow-whale-q2x9` and nobody has opened it before
  - **THEN** they see a fresh board for that jam

### Requirement: Malformed jam links

The app SHALL refuse jam links whose slug does not have the jam link format, both for the page and for the board connection.

- **Scenario: Bad slug**
  - **WHEN** someone opens `/jam/../../etc` or connects to the board of `not a slug`
  - **THEN** they get a not-found page, and the connection is refused with no board created
- **Scenario: Unknown page**
  - **WHEN** someone opens a path that is neither `/`, `/about`, `/ds` nor a jam link
  - **THEN** they get a "No jam here" page with links to start a new jam and to the about page

### Requirement: Link is access

Anyone with a jam's link SHALL be able to open and edit its board, without an account.

- **Scenario: Share the link**
  - **GIVEN** a jam someone is editing
  - **WHEN** they send its link to a friend who opens it
  - **THEN** the friend sees the same board and can edit it

### Requirement: About page

`/about` SHALL say what jambo is, how to play, how to connect an AI app over MCP, and who made it and why. It SHALL show the MCP server URL for the current host with a Copy button, and setup steps for Claude, Claude Code, ChatGPT, Gemini, Codex and other MCP clients, one app at a time. `/docs` SHALL redirect permanently to `/about`.

- **Scenario: Pick an AI app**
  - **WHEN** someone on `/about` picks ChatGPT
  - **THEN** they see ChatGPT's setup steps, and the server URL ends in `/mcp` on the host they are on
- **Scenario: Old docs link**
  - **WHEN** someone opens `/docs#ai`
  - **THEN** they land on `/about#ai`, at the Bring your AI section

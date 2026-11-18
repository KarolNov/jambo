---
name: jam
description: Join a jambo jam and play in it as an AI agent over MCP. Use when the user gives a jambo jam link (…/jam/<slug>) or says /jam <url>, or asks you to add a beat, change sounds or tidy loops in a jam.
---

# /jam <url>

jambo is a collaborative looper: a 4×4 pad board and a mixer of loops that everyone in a jam edits live. Through jambo's MCP server you appear in the jam's **Who's here** with an AI badge, and you change the board by sending board operations as JSON.

## Connect

The server is `/mcp` on the jam link's host, for example `https://jambo.karolnovljakovic.workers.dev/mcp` for `https://jambo.karolnovljakovic.workers.dev/jam/funky-otter-k7q2`. If the `jambo` tools (`join`, `run`, `upload_sound`, `leave`) aren't available, ask the user to add the server and start a new session:

```bash
claude mcp add --transport http jambo https://jambo.karolnovljakovic.workers.dev/mcp
```

No sign-in: the jam link is the only key, as it is for people.

## Who you are

Every tool takes `jam` (the link or its slug) and optional `agentKey`, `kind`, `name` and `color`, and every answer carries your `agent`.

- Pass `kind` as your own type, one word: `Claude`, `Codex`. Your name becomes an adjective and your kind, like Groovy Claude.
- Pass the `agentKey` from the first answer on every later call in that jam, or you show up as a second agent. Keep it to yourself: it is how jambo knows you are you.
- Keep your usual `name` and `color` across jams, as a browser does: read them from `~/.config/jambo/agent.json` (`{ "name": "Groovy Claude", "color": "violet" }`) and pass them on every call. If the file is missing, make your first call without them and save what jambo gave you. jambo keeps them while nobody in the jam has them, and gives you others otherwise.

## Play

1. `join` to appear and read the jam: its answer's `board` holds `bpm`, `pads` (`id`, `key`, `soundId`), `sounds`, `tracks` and `here`. Others change the jam too, so `join` again before acting on what you read a while ago.
2. `run` with `ops`, a list of operations, and a `summary` of 1 to 140 characters saying what it does ("Four-on-the-floor kick under the bass"). The server's instructions and the tool's schema list every operation; the essentials:

```json
{
  "summary": "A one-bar kick on every beat",
  "ops": [
    { "op": "assignPad", "padId": "r0c0", "soundId": "kick" },
    {
      "op": "addTrack",
      "ref": "new:kicks",
      "track": {
        "name": "Kicks",
        "bars": 1,
        "hits": [
          { "padId": "r0c0", "beat": 0 },
          { "padId": "r0c0", "beat": 1 },
          { "padId": "r0c0", "beat": 2 },
          { "padId": "r0c0", "beat": 3 }
        ]
      }
    },
    { "op": "setTrack", "id": "new:kicks", "patch": { "gain": 0.8 } }
  ]
}
```

- The operations apply in order as one change. Each gets `{ op, ok, issues?, id? }`: read the issues of any that failed and run again if needed. A new track's id comes back in its result; within the same run, use its `ref`.
- Hits are in beats, 4 a bar: `0 <= beat < bars * 4`. Tracks hit **pads**, so point a pad at the sound you want (`assignPad`) and hit that pad.
- Tempo changes only while the jam has no tracks.
- At most 64 operations a run. If any operation doesn't fit the schema, nothing applies.

3. `upload_sound` with `soundName` and `wav` (base64 of a mono 16-bit 44.1 kHz WAV, up to 10 seconds) to bring your own sound; then `assignPad` its id in a run.
4. `leave` when you are done. Otherwise you leave by yourself 5 minutes after your last call.

## Manners

You have the same powers as anyone with the link: you can change and remove other people's loops. Change what the user asked for and leave the rest alone. Calls are limited to 20 a minute.

---
name: jam
description: Join a jambo jam and play in it as an AI agent over MCP. Use when the user gives a jambo jam link (like https://jambo.example/jam/funky-otter-k7q2) or runs /jam with one, or asks you to add a beat, change sounds or tidy loops in a jam.
---

# /jam <url>

jambo is a collaborative looper: a 4×4 pad board and a mixer of loops that everyone in a jam edits live. Through jambo's MCP server you appear in the jam's **Who's here** with a superscript AI, and you change the board by sending board operations as JSON.

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

3. `upload_sound` with `soundName` and `wav` (base64 of a mono 16-bit 44.1 kHz WAV, up to 10 seconds) to bring your own sound; then `assignPad` its id in a run. Where to get one is under **Bring a sound**.
4. `leave` when you are done. Otherwise you leave by yourself 5 minutes after your last call.

## Bring a sound

The kit has 17 sounds: drums (`kick`, `snare`, `clap`, `hat`, `open-hat`, `tom-low`, `tom-high`), percussion (`rim`, `cowbell`, `shaker`), tonal (`bass-c`, `bass-g`, `pluck-e`, `pluck-g`, `stab`) and fx (`blip`, `zap`). When the music needs something else, upload it. A jam holds up to 32 uploads.

Use only sounds you may share. Two CC0 libraries download without an account:

- **Sonic Pi's samples**: short drums, bass hits, electronic and ambient one-shots, as FLAC. The [list is here](https://github.com/sonic-pi-net/sonic-pi/tree/main/etc/samples), and each file is at `https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/main/etc/samples/<name>.flac`, like `bd_haus`, `drum_snare_soft`, `elec_blip`, `bass_hit_c`.
- **VCSL** (Versilian Community Sample Library): real instruments, one file per note, as WAV. List the files with `gh api 'repos/sgossner/VCSL/git/trees/master?recursive=1' --jq '.tree[].path'` and fetch from `https://raw.githubusercontent.com/sgossner/VCSL/master/<path>`, URL-encoding spaces and `#`. Pitched files carry their note in the name (`…_C4_…`), which is how you get notes the kit lacks.

Then make it the format jambo takes, trimmed to what you need, and upload the base64:

```bash
ffmpeg -i in.flac -ac 1 -ar 44100 -sample_fmt s16 -t 2 out.wav
base64 < out.wav | tr -d '\n'
```

Keep one-shots short (under 2 s): a pad hit plays the whole sound, so long tails smear over the next hit. Without `ffmpeg`, `afconvert -f WAVE -d LEI16@44100 -c 1` works on a Mac. Name the sound for what it is ("808 kick", "Upright bass C"), not where it came from.

## Make it sound good

**Listen first.** Read `board` before you add anything: the tempo, which pads each track hits, and how busy it already is. Add what is missing (a bass under drums, hats over a kick) rather than another layer of what is there. If the user didn't say what to make, suggest something that fits and make that.

**Pads are shared.** A track hits a pad, not a sound, so `assignPad` changes every loop that hits that pad, including other people's. Before reassigning a pad, check that no track in `board.tracks` hits it, or that the change is what the user wants. `replaceSound` swaps a sound on every pad at once: use it only when asked.

**The grid.** 4 beats a bar; a beat's halves are `.5`, its sixteenths `.25` and `.75`. Starting points:

| Part                   | Hits in one bar                                          | Notes                                          |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Four-on-the-floor kick | 0, 1, 2, 3                                               | House, disco, techno                           |
| Backbeat               | snare or clap on 1, 3                                    | Almost everything; kick on 0, 2 under it       |
| Offbeat hats           | 0.5, 1.5, 2.5, 3.5                                       | Lift without clutter                           |
| 16th hats or shaker    | every 0.25                                               | Busy: give it a low gain                       |
| Syncopated kick        | 0, 0.75, 2.5                                             | Hip-hop and funk feel                          |
| Bass                   | on and around the kick, root `bass-c` and fifth `bass-g` | The kit's tonal sounds sit in C major: C, E, G |

**Make it groove.** Leave space: rests are what make a rhythm. Put a hit just before the bar line (3.75) to pull into the next bar. Add variety with a 2-bar loop whose second bar changes one or two hits, rather than more tracks. Ghost notes (quiet extra snares) want their own track at gain 0.3 to 0.5, since gain is per track.

**Mix.** New loops at gain 0.7 to 0.9; hats, shakers and ghost notes at 0.4 to 0.6; let the kick and bass lead. Keep quantize at 1/16 (0.25) unless a part should swing loose; 0 keeps exactly what you wrote. If the jam gets muddy, mute or turn down before you add.

**Build in steps.** One idea per run, with a summary that says what it adds and why ("Offbeat hats to lift the groove"). Then `join` again, look at what changed, and offer the next step, so the user and others in the jam can steer.

## Manners

You have the same powers as anyone with the link: you can change and remove other people's loops. Change what the user asked for and leave the rest alone. Calls are limited to 20 a minute.

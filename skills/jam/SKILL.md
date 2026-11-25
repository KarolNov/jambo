---
name: jam
description: Join a jambo jam and play in it as an AI agent over MCP, listening to what people change and answering it. Use when the user gives a jambo jam link (like https://jambo.example/jam/funky-otter-k7q2) or runs /jam with one, or asks you to add a beat, change sounds, tidy loops or jam along in a jam.
---

# /jam <url>

jambo is a collaborative looper: a 4×4 pad board and a mixer of loops that everyone in a jam edits live. Through jambo's MCP server you appear in the jam's **Who's here** with a superscript AI, and you change the board by sending board operations as JSON.

## Connect

The server is `/mcp` on the jam link's host, for example `https://jambo.karolnov.dev/mcp` for `https://jambo.karolnov.dev/jam/funky-otter-k7q2`. If the `jambo` tools (`join`, `listen`, `run`, `upload_sound`, `leave`) aren't available, ask the user to add the server and start a new session:

```bash
claude mcp add --transport http jambo https://jambo.karolnov.dev/mcp
```

Each server plays only its own jams: pass the whole link, not just the slug, and a server refuses a link on another host, naming the `/mcp` to add for it. For a preview or dev deploy, add its `/mcp` under another name (`claude mcp add --transport http jambo-dev https://<host>/mcp`) and use that server's tools for its jams.

No sign-in: the jam link is the only key, as it is for people. A deploy behind Cloudflare Access refuses agents; ask the user for a public one.

## Who you are

Every tool takes `jam` (the link or its slug) and optional `agentKey`, `kind`, `name` and `color`. Every `join`, `run` and `upload_sound` that succeeds answers with your `agent`; refusals and `leave` don't.

- Pass `kind` as your own type, one word: `Claude`, `Codex`. Your name becomes an adjective and your kind, like Groovy Claude.
- Pass the `agentKey` from the first answer on every later call in that jam, or you show up as a second agent: it is `agent.agentKey` in the answer. A jam seats at most 8 agents, 3 from one address, so a call without your key can be refused once you have used up your seats. Keep it to yourself: it is how jambo knows you are you.
- Keep your usual `name` and `color` across jams, as a browser does: read them from `~/.config/jambo/agent.json` (`{ "name": "Groovy Claude", "color": "violet" }`) and pass them on every call. If the file is missing, make your first call without them and save what jambo gave you. jambo keeps them while nobody in the jam has them, and gives you others otherwise. Your `agentKey` also brings back the kind, name and colour you had in that jam when you return after leaving or idling out, for 7 days; passing them anyway is harmless.

## Play

1. `join` to appear and read the jam: its answer's `board` holds `bpm`, `pads` (`id`, `key`, `soundId`), `sounds`, `tracks`, `master` (the master knobs and touchpad modes) and `here`. Others change the jam too: `listen` (under **Jam live**) tells you what they changed since you last looked, without reading the whole board again.
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
- Every track has five optional sound knobs, set in `addTrack`'s `track` or `setTrack`'s `patch`: `reverb` and `echo` (0 to 1), `tone` (-1 to 1: below 0 darker, above 0 thinner), `pitch` (whole semitones, -12 to 12; also changes speed) and `pan` (-1 left to 1 right). A track without one plays at its default, which leaves the sound as it is: 0 for all five.
- Tempo changes only while the jam has no tracks.
- The **master stage** shapes the whole mix, for everyone. `{ "op": "setMaster", "set": { "swing": 0.3 } }` turns any of four knobs; ones left out keep their value: `tone` (-1 to 1: darker below 0, thinner above), `drive` (0 to 1: saturation and glue), `width` (-1 mono to 1 extra wide) and `swing` (0 to 1: delays every off-beat 16th, up to half a 16th). `{ "op": "setFx", "mode": "filter", "x": -0.6, "y": 0.2 }` puts one touchpad mode at x, y: `filter` (x -1 to 1: low-pass below 0, high-pass above; y resonance), `throw` (an echo of the whole mix: x picks 1/8, dotted 1/8 or 1/4 by thirds; y the send and feedback), `lofi` (x lowers the sample rate, y the bit depth) and `repeat` (stutters the loops: x picks a 1/4, 1/8, 1/16 or 1/32 slice by quarters; y the repeats' level, 0 off). Modes stay where they are left and all can be on at once; 0/0 is off, so `setFx` at 0/0 is the reset. Every default is 0, which leaves the sound as it is.
- While a person is turning a control (a track's gain or sound knob, a master knob or a touchpad mode), it is theirs: an operation on it comes back with the issue `Held by <name>`. A `setMaster` or `setTrack` drops only the held knobs or fields and applies the rest. Try again in a moment rather than fighting them.
- At most 64 operations a run. If any operation doesn't fit the schema, nothing applies.

3. `upload_sound` with `soundName` and `wav` (base64 of a mono 16-bit 44.1 kHz WAV, up to 10 seconds) to bring your own sound; then `assignPad` its id in a run. Where to get one is under **Bring a sound**.
4. `leave` when you are done. Otherwise you leave by yourself 5 minutes after your last call. Come back with the same `agentKey` and you are the same agent, with your tracks and your name.

## Jam live

`listen` is how you hear the others. Pass your `agentKey` and `wait` (seconds, up to 25; default 20): it waits until someone changes the jam, then answers only what changed since you last looked, your own runs left out:

```json
{
  "changes": [
    { "what": "master", "set": { "drive": 0.7 } },
    { "what": "trackChanged", "id": "0mw…", "name": "Hats", "set": { "gain": 0.4 } }
  ],
  "holding": [{ "control": "fx.filter", "by": "Misty Yak" }]
}
```

- `changes` come as `tempo`, `pad`, `soundAdded`, `soundRemoved`, `trackAdded`, `trackRemoved`, `trackChanged` (only the changed fields, new values), `master` (only the changed knobs and modes), `joined` and `left`. A knob drag comes as one change with where it ended.
- `holding` is who is turning which control right now: `master.<knob>`, `fx.<mode>` or `track.<trackId>.<field>`. Leave those alone until they let go; it is also a cue to what they're doing.
- `changes: []` with the same `holding` means the wait ran out with nothing new. When the jam doesn't remember what you last saw (your first `listen`, or after a while), it answers `board` too, as `join` does.
- `listen` doesn't count toward the 20 calls a minute, and answers at most every 3 seconds.

To jam along, loop until the user stops you or the jam goes quiet for a few minutes:

1. `listen`.
2. If someone changed something, answer it musically, in one small `run`: they filtered down, so thin your part; they added a bass, so leave room for it; they turned drive up, so keep your parts sparse. Not every change needs an answer: often the best move is none.
3. Say in a line what you heard and what you did, then `listen` again.

Keep runs small and few while you listen, so people stay in charge: you are a bandmate, not the producer.

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

**Shape each track.** The knobs act on the whole track, so a sound that needs two treatments wants two tracks. Change them a little at a time; small moves sound best.

- **Space.** Keep the kick and bass dry and centred (`reverb` 0, `pan` 0) so the low end stays tight. Give snares, claps and plucks a little room (`reverb` 0.15 to 0.3); pads and fx can take more (0.4 to 0.6). Too much reverb on everything is the quickest way to mud.
- **Echo.** It is timed to the tempo, so it adds rhythm: a little (0.15 to 0.3) on a sparse stab, pluck or clap fills the gaps. Leave it off busy parts like 16th hats, where it smears.
- **Width.** Pan parts that play together apart: hats a touch one way (0.2 to 0.4), shaker or a percussion part the other. Keep the lead part of each range near the middle.
- **Tone.** Turn `tone` down (-0.2 to -0.5) to tuck a busy part behind the others or soften harsh hats; turn it up (0.2 to 0.4) to take the boom out of a part that crowds the bass.
- **Pitch.** Shift a sound to get a note the kit lacks: `bass-c` up 2 is D, up 5 is F; from C, 4 is E and 7 is G. It also speeds the sound up (shorter) or slows it down (longer), so a kick or tom pitched down a few semitones sounds bigger. Stay in key with what is playing: C major's notes are 0, 2, 4, 5, 7, 9 and 11 semitones above C.
- When someone else's track is too loud or wet, ask before you change it.

**The master stage is everyone's.** It changes how the whole jam sounds for everyone in it, so touch it only when the user asks, or for a moment that needs it: a filter sweep down into a drop and back to 0/0, a short throw on the last bar of a phrase, a bar of repeat as a fill. Reset what you turned on when the moment passes, unless the user wants it to stay. A little goes a long way: swing 0.2 to 0.4 loosens straight 16ths, and `drive` above 0.5 turns gritty.

**Build in steps.** One idea per run, with a summary that says what it adds and why ("Offbeat hats to lift the groove"). Then `listen`, hear what others did, and offer the next step, so the user and others in the jam can steer.

## Manners

You have the same powers as anyone with the link: you can change and remove other people's loops. Change what the user asked for and leave the rest alone. Calls other than `listen` are limited to 20 a minute.

// Live voice spike (throwaway): one tab publishes stamped Opus frames on an unordered,
// no-retransmit Realtime DataChannel; the other plays them at stamp + 1 bar.
// Times are epoch ms (performance.timeOrigin + performance.now()): both tabs run on one
// machine, so the clock is shared and one-way delay is exact.

const now = () => performance.timeOrigin + performance.now()
const HEADER = 4 + 8 + 8 // seq u32, stamp f64 (capture time), sentAt f64
const FRAME_MS = 20
const SR = 48000
const FRAME_SAMPLES = (SR * FRAME_MS) / 1000

let pc
let channel

function pct(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
function summary(values) {
  const s = [...values].sort((a, b) => a - b)
  const r = (x) => (x == null ? null : Math.round(x * 10) / 10)
  return {
    n: s.length,
    min: r(s[0]),
    p50: r(pct(s, 50)),
    p95: r(pct(s, 95)),
    p99: r(pct(s, 99)),
    max: r(s[s.length - 1]),
  }
}

window.spike = {
  async init() {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
    })
    return true
  },

  async answer(offer) {
    await pc.setRemoteDescription(offer)
    await pc.setLocalDescription(await pc.createAnswer())
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve()
      const t = setTimeout(resolve, 3000)
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') (clearTimeout(t), resolve())
      })
    })
    return { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
  },

  async connected() {
    const t0 = now()
    while (pc.connectionState !== 'connected') {
      if (pc.connectionState === 'failed') throw new Error('pc failed')
      if (now() - t0 > 30000) throw new Error('pc not connected: ' + pc.connectionState)
      await new Promise((r) => setTimeout(r, 50))
    }
    return pc.connectionState
  },

  async openChannel(id) {
    channel = pc.createDataChannel('voice', {
      negotiated: true,
      id,
      ordered: false,
      maxRetransmits: 0,
    })
    channel.binaryType = 'arraybuffer'
    await new Promise((resolve, reject) => {
      channel.onopen = resolve
      setTimeout(() => reject(new Error('channel did not open')), 15000)
    })
    return { ordered: channel.ordered, maxRetransmits: channel.maxRetransmits, id: channel.id }
  },

  // Publisher: a 220 Hz tone with a click every beat, encoded as 20 ms Opus frames at 32 kbps.
  async send({ seconds, shedBytes }) {
    let shed = 0
    const total = (seconds * 1000) / FRAME_MS
    const start = now() + 100
    let maxBuffered = 0
    let sent = 0
    let encoderLag = []
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const seq = Math.round(chunk.timestamp / (FRAME_MS * 1000))
        if (seq >= total) return // padding the encoder emits on flush
        const stamp = start + seq * FRAME_MS
        const buf = new ArrayBuffer(HEADER + chunk.byteLength)
        const view = new DataView(buf)
        const sentAt = now()
        view.setUint32(0, seq)
        view.setFloat64(4, stamp)
        view.setFloat64(12, sentAt)
        chunk.copyTo(new Uint8Array(buf, HEADER))
        encoderLag.push(sentAt - (stamp + FRAME_MS)) // time from end of frame capture to send
        // Optional: drop the frame instead of queueing it behind a congested SCTP send buffer.
        if (shedBytes && channel.bufferedAmount > shedBytes) shed++
        else if (channel.readyState === 'open') channel.send(buf)
        maxBuffered = Math.max(maxBuffered, channel.bufferedAmount)
        sent++
      },
      error: (e) => console.error(e),
    })
    const config = {
      codec: 'opus',
      sampleRate: SR,
      numberOfChannels: 1,
      bitrate: 32000,
      opus: { frameDuration: FRAME_MS * 1000 },
    }
    const support = await AudioEncoder.isConfigSupported(config)
    if (!support.supported) throw new Error('opus encoder unsupported')
    encoder.configure(config)

    let i = 0
    await new Promise((resolve) => {
      const tick = () => {
        // Feed every frame whose capture would have ended by now (as a mic worklet would).
        while (i < total && start + (i + 1) * FRAME_MS <= now()) {
          const data = new Float32Array(FRAME_SAMPLES)
          for (let k = 0; k < FRAME_SAMPLES; k++) {
            const t = (i * FRAME_SAMPLES + k) / SR
            data[k] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + (t % 0.6 < 0.01 ? 0.5 : 0)
          }
          encoder.encode(
            new AudioData({
              format: 'f32',
              sampleRate: SR,
              numberOfFrames: FRAME_SAMPLES,
              numberOfChannels: 1,
              timestamp: i * FRAME_MS * 1000,
              data,
            }),
          )
          i++
        }
        if (i >= total) return resolve()
        setTimeout(tick, 5)
      }
      tick()
    })
    await encoder.flush()
    return {
      frames: total,
      sent,
      shed,
      maxBufferedBytes: maxBuffered,
      encoderLagMs: summary(encoderLag),
    }
  },

  // Listener: jitter buffer keyed by seq, decode in order ~200 ms ahead, play at stamp + bar.
  listen({ barMs }) {
    const ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' })
    const LEAD = 200 // decode this far ahead of playback
    const MIN_HEADROOM = 10 // a frame decoded later than this before its time is dropped
    const arrivals = new Map() // seq -> { stamp, sentAt, arrive, data }
    const oneWay = []
    const stampToArrive = []
    const headroom = []
    let jitter = 0
    let lastTransit = null
    let maxSeq = -1
    let reordered = 0
    let late = 0
    let lateDecode = 0
    let played = 0
    let nextDecode = 0
    let bytes = 0
    let first = null
    const pendingTargets = [] // FIFO of { ts, at } for frames sent to the decoder
    let outputs = 0
    let tsMismatch = 0
    let decoded = 0
    const seen = new Set()

    const decoder = new AudioDecoder({
      output: (audio) => {
        outputs++
        const target = pendingTargets.shift() // Opus: one output per decoded frame, in order
        if (audio.timestamp !== target.ts) tsMismatch++
        const buf = ctx.createBuffer(1, audio.numberOfFrames, audio.sampleRate)
        audio.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' })
        audio.close()
        const room = target.at - now()
        if (room < MIN_HEADROOM) {
          lateDecode++
          return
        }
        headroom.push(room)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start(ctx.currentTime + room / 1000)
        played++
      },
      error: (e) => console.error(e),
    })
    decoder.configure({ codec: 'opus', sampleRate: SR, numberOfChannels: 1 })

    channel.onmessage = (e) => {
      const arrive = now()
      const view = new DataView(e.data)
      const seq = view.getUint32(0)
      const stamp = view.getFloat64(4)
      const sentAt = view.getFloat64(12)
      bytes += e.data.byteLength
      seen.add(seq)
      first ??= arrive
      const transit = arrive - sentAt
      oneWay.push(transit)
      stampToArrive.push(arrive - stamp)
      if (lastTransit != null) jitter += (Math.abs(transit - lastTransit) - jitter) / 16 // RFC 3550
      lastTransit = transit
      if (seq < maxSeq) reordered++
      maxSeq = Math.max(maxSeq, seq)
      if (arrive > stamp + barMs - MIN_HEADROOM) {
        late++
        return
      }
      arrivals.set(seq, { stamp, data: new Uint8Array(e.data, HEADER) })
    }

    // Decode in seq order once a frame is within LEAD of its playback time; skip gaps.
    const pump = () => {
      const t = now()
      for (const seq of [...arrivals.keys()].sort((a, b) => a - b)) {
        const f = arrivals.get(seq)
        if (f.stamp + barMs - t > LEAD) break
        arrivals.delete(seq)
        if (seq < nextDecode) continue
        nextDecode = seq + 1
        const ts = seq * FRAME_MS * 1000
        pendingTargets.push({ ts, at: f.stamp + barMs })
        decoded++
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, data: f.data }))
      }
    }
    const timer = setInterval(pump, 5)

    window.spike.results = async (sentFrames) => {
      clearInterval(timer)
      pump()
      await decoder.flush().catch(() => {})
      let received = 0
      for (const q of seen) if (q < sentFrames) received++
      const secs = (now() - first) / 1000
      return {
        barMs,
        sent: sentFrames,
        received,
        lost: sentFrames - received,
        lossPct: Math.round(((sentFrames - received) / sentFrames) * 1000) / 10,
        lateArrivals: late,
        lateDecode,
        played,
        decoded,
        decoderOutputs: outputs,
        tsMismatch,
        playedPct: Math.round((played / sentFrames) * 1000) / 10,
        reordered,
        jitterMs: Math.round(jitter * 10) / 10,
        oneWayMs: summary(oneWay),
        stampToArriveMs: summary(stampToArrive),
        playbackHeadroomMs: summary(headroom),
        kbpsPayload: Math.round((bytes * 8) / secs / 100) / 10,
        audioState: ctx.state,
        outputLatencyMs: Math.round((ctx.outputLatency || 0) * 1000),
      }
    }
    return ctx.state
  },

  async stats() {
    const out = {}
    ;(await pc.getStats()).forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated)
        out.rttMs = Math.round(s.currentRoundTripTime * 1000)
      if (s.type === 'transport')
        ((out.bytesSent = s.bytesSent), (out.bytesReceived = s.bytesReceived))
      if (s.type === 'remote-candidate') out.remote = `${s.address ?? ''}:${s.port} ${s.protocol}`
    })
    return out
  },
}

import { useEffect, useRef, useState } from 'react'
import { BEATS_PER_BAR, type Hit } from '../../../shared/board'
import { useSession } from '../session'
import { type TakeView, takeMarks, takeView } from '../transport'
import { beatPosition } from './loops'

const UNIT: Record<TakeView['stage'], string> = {
  waiting: '',
  'count-in': 'COUNT',
  recording: 'BAR',
}

/**
 * The readout during a take, in place of the tempo: the bar being recorded (the count during the
 * count-in) large, the beat of the bar as numbers lit like LEDs beside it, and under them, where the
 * phase reads between takes (the record button says it during one), a lane that grows a bar at a
 * time with a playhead and your hits where they will play. Hits and lit beats take `--c`, set by the readout.
 * It reads the engine every frame; it re-renders only when the beat or the hits change.
 */
export function TakeLane() {
  const { engine } = useSession()
  const lane = useRef<HTMLDivElement>(null)
  const [take, setTake] = useState<{ view: TakeView; hits: readonly Hit[] }>({
    view: { stage: 'waiting' },
    hits: [],
  })

  useEffect(() => {
    let frame = 0
    let key = ''
    const step = () => {
      const now = engine.take()
      if (now) {
        const view = takeView(now.beat)
        const next = `${JSON.stringify(view)}/${now.hits.length}`
        if (next !== key) {
          key = next
          setTake({ view, hits: [...now.hits] })
        }
        if (view.stage === 'recording')
          lane.current?.style.setProperty(
            '--p',
            String(Math.min(1, now.beat / (view.bars * BEATS_PER_BAR))),
          )
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [engine])

  const { view } = take
  const bars = view.stage === 'recording' ? view.bars : 1
  const lit = view.stage === 'recording' ? view.beat : view.stage === 'count-in' ? view.count : 0
  const big = view.stage === 'recording' ? view.bar : view.stage === 'count-in' ? view.count : '–'

  return (
    <>
      <span className="console-bpm console-take-big" data-stage={view.stage}>
        {big}
      </span>
      <span className="console-bpm-unit">{UNIT[view.stage]}</span>
      <div className="console-take-beats">
        {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
          <span key={i} className={i + 1 === lit ? 'is-lit' : undefined}>
            {i + 1}
          </span>
        ))}
      </div>
      <div ref={lane} className="console-pattern console-take-lane">
        {Array.from({ length: bars * BEATS_PER_BAR }, (_, b) => (
          <span
            key={b}
            className={`console-beat ${b % BEATS_PER_BAR === 0 ? 'is-bar' : ''}`}
            style={{ left: beatPosition(b, bars) }}
          />
        ))}
        {takeMarks(take.hits, bars).map((h, i) => (
          <span key={i} className="console-hit" style={{ left: beatPosition(h.beat, bars) }} />
        ))}
        {view.stage === 'recording' && <span className="console-head" />}
      </div>
    </>
  )
}

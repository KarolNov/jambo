/** The mixer's helpers, still in prototype form; see ./Neumo.tsx. */
import { useEffect } from 'react'
import { useSession } from '../session'

/** Sets `--p` (0–1, the loop's position) and `data-playing` on `ref`, every frame. */
export function usePlayhead(trackId: string, ref: React.RefObject<HTMLElement | null>) {
  const { engine } = useSession()
  useEffect(() => {
    let frame = 0
    const step = () => {
      const pos = engine.position(trackId)
      const el = ref.current
      if (el) {
        el.style.setProperty('--p', String(pos ?? 0))
        el.dataset.playing = pos === undefined ? 'false' : 'true'
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [engine, trackId, ref])
}

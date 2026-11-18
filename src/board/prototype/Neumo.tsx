/**
 * The jam as a soft "console": header, deck and mixer (src/board/console). Open a jam with
 * `?variant` on the dev server.
 */
import { useThemedPage } from '../../theme/theme'
import { Deck } from '../console/Deck'
import { Header } from '../console/Header'
import { Mixer } from '../console/Mixer'
import { Unlock } from '../console/Pads'
import type { ConnectionStatus } from '../doc'
import './neumo.css'

export default function Neumo({ slug, status }: { slug: string; status: ConnectionStatus }) {
  useThemedPage()
  return (
    <div className="neumo">
      <main className="neumo-page">
        <Header slug={slug} status={status} />
        <Unlock />
        <Deck slug={slug} />
        <Mixer />
      </main>
    </div>
  )
}

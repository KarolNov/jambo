import { createContext, useContext } from 'react'
import { board, type Board } from '../../shared/board'
import type { Engine } from '../audio/engine'
import type { Me } from './seat'
import type { JamSession } from './doc'

export interface Session {
  jam: JamSession
  engine: Engine
  /** This person here: their id, and their name and colour in this jam. */
  me: Me
  /** The board SDK, writing as this browser. */
  board: Board
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession outside a jam')
  return session
}

export const makeBoard = (jam: JamSession, me: { id: string }) =>
  board(jam.doc, { kind: 'user', id: me.id })

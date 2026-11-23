import { describe, expect, it } from 'vitest'
import { connectionStatus } from '../src/board/connection'

describe('connectionStatus', () => {
  it('is live while connected', () => {
    expect(connectionStatus('connected', true, true)).toBe('connected')
  })

  it('is connecting until the first connection, whether trying or between tries', () => {
    expect(connectionStatus('connecting', false, true)).toBe('connecting')
    expect(connectionStatus('disconnected', false, true)).toBe('connecting')
  })

  // @scenario board/session: Connection drops
  it('is reconnecting after a drop, between tries too, not offline', () => {
    expect(connectionStatus('disconnected', true, true)).toBe('reconnecting')
    expect(connectionStatus('connecting', true, true)).toBe('reconnecting')
  })

  // @scenario board/session: No network
  it('is offline while the browser has no network, whatever the socket says', () => {
    expect(connectionStatus('connecting', true, false)).toBe('offline')
    expect(connectionStatus('connected', true, false)).toBe('offline')
  })
})

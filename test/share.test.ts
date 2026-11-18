import { describe, expect, it } from 'vitest'
import { jamLink, shareLink } from '../src/board/console/share'

const abort = () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' }))
const ok = () => Promise.resolve()
const boom = () => Promise.reject(new Error('nope'))

describe('sharing a jam', () => {
  it('links to the jam without query or hash', () => {
    expect(jamLink('https://jambo.dev', 'funky-otter-k7q2')).toBe(
      'https://jambo.dev/jam/funky-otter-k7q2',
    )
  })

  it('uses the share sheet when there is one', async () => {
    const seen: unknown[] = []
    const share = async (d: unknown) => void seen.push(d)
    expect(await shareLink('u', 't', { share, copy: boom })).toBe('shared')
    expect(seen).toEqual([{ title: 't', url: 'u' }])
  })

  it('counts closing the share sheet as cancelled, without copying', async () => {
    let copied = false
    const copy = async () => void (copied = true)
    expect(await shareLink('u', 't', { share: abort, copy })).toBe('cancelled')
    expect(copied).toBe(false)
  })

  it('copies the link when there is no share sheet, or it fails', async () => {
    expect(await shareLink('u', 't', { copy: ok })).toBe('copied')
    expect(await shareLink('u', 't', { share: boom, copy: ok })).toBe('copied')
  })

  it('reports a failed copy', async () => {
    expect(await shareLink('u', 't', { copy: boom })).toBe('failed')
    expect(await shareLink('u', 't', {})).toBe('failed')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import About from '../../src/about/About'
import { App } from '../../src/App'
import { mockServer, Themed } from './jam'

/** The test page's own address, put back after each test that routes elsewhere. */
let home: string

beforeEach(() => {
  home = window.location.pathname + window.location.search
})

afterEach(() => {
  history.replaceState(null, '', home)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Renders the app as if the browser had opened `path`. */
function open(path: string) {
  history.replaceState(null, '', path)
  return render(<App />)
}

describe('routes', () => {
  // @scenario collab/jams: Unknown page
  it('shows "No jam here" with links to a new jam and the about page', async () => {
    mockServer()
    await open('/no/such/page')
    await expect.element(page.getByRole('heading', { name: 'No jam here' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Start a new jam' }))
      .toHaveAttribute('href', '/')
    await expect
      .element(page.getByRole('link', { name: 'What is jambo?' }))
      .toHaveAttribute('href', '/about')
  })

  // @scenario collab/jams: Server unavailable
  it('says it could not start a jam when the root cannot create one', async () => {
    const fetch = mockServer((url, init) =>
      url === '/api/jams' && init?.method === 'POST'
        ? new Response('Service unavailable', { status: 503 })
        : undefined,
    )
    await open('/')
    await expect
      .element(page.getByText('Could not start a jam. Try again in a moment.'))
      .toBeVisible()
    expect(fetch).toHaveBeenCalledWith('/api/jams', { method: 'POST' })
    expect(window.location.pathname).toBe('/')
  })
})

describe('about page', () => {
  // @scenario collab/jams: Pick an AI app
  it("shows ChatGPT's setup steps and this host's /mcp server URL", async () => {
    await render(
      <Themed>
        <About />
      </Themed>,
    )
    await userEvent.click(page.getByRole('tab', { name: 'ChatGPT' }))
    const panel = page.getByRole('tabpanel')
    await expect.element(panel).toHaveTextContent('chatgpt.com')
    await expect.element(panel).toHaveTextContent('Developer mode')
    await expect
      .element(page.getByText(`${window.location.origin}/mcp`, { exact: true }).first())
      .toBeVisible()
  })
})

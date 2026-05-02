import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const device = { id: 'd1', label: 'Front Door', topic: 'home/front-door', type: 'sensor' }
const config = { autoDiscovery: false }

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const body = routes[url]
    if (body === undefined) throw new Error(`Unmocked fetch: ${url}`)
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('renders registered devices on load', async () => {
    mockFetch({
      '/api/devices': [device],
      '/api/config': config,
      '/api/unregistered-devices': [],
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Front Door')).toBeInTheDocument())
    expect(screen.getByText('home/front-door')).toBeInTheDocument()
  })

  it('shows empty state when no devices', async () => {
    mockFetch({
      '/api/devices': [],
      '/api/config': config,
      '/api/unregistered-devices': [],
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText(/no devices registered/i)).toBeInTheDocument()
    )
  })
})

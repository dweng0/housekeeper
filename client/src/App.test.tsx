import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const device = { id: 'd1', label: 'Front Door', topic: 'home/front-door', type: 'sensor' }
const actuator = { id: 'd2', label: 'Hallway Light', topic: 'home/hallway/light', type: 'actuator' }
const config = { autoDiscovery: false }
const automation = {
  id: 'a1',
  enabled: true,
  trigger: { deviceLabel: 'Front Door', event: 'open' },
  actions: [{ deviceLabel: 'Hallway Light', command: 'on' }],
}

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (init?.method === 'PUT' || init?.method === 'POST' || init?.method === 'DELETE') {
      const body = routes[url]
      if (body === undefined) throw new Error(`Unmocked fetch: ${url}`)
      return {
        ok: true,
        status: init.method === 'POST' ? 201 : init.method === 'DELETE' ? 204 : 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }
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
      '/api/automations': [],
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
      '/api/automations': [],
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText(/no devices registered/i)).toBeInTheDocument()
    )
  })
})

describe('Automations', () => {
  it('renders automations list on load', async () => {
    mockFetch({
      '/api/devices': [device, actuator],
      '/api/config': config,
      '/api/unregistered-devices': [],
      '/api/automations': [automation],
    })

    render(<App />)

    await waitFor(() => expect(screen.getByRole('heading', { name: /devices/i })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /automations/i })).toBeInTheDocument()
    expect(screen.getAllByText('Front Door').length).toBeGreaterThan(0)
  })

  it('shows empty state when no automations', async () => {
    mockFetch({
      '/api/devices': [],
      '/api/config': config,
      '/api/unregistered-devices': [],
      '/api/automations': [],
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText(/no automations/i)).toBeInTheDocument()
    )
  })
})

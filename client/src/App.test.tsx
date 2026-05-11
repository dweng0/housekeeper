import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

const baseRoutes = {
  '/api/voice-nodes': [],
  '/api/logs': [],
}

describe('App', () => {
  it('renders registered devices on load', async () => {
    mockFetch({
      ...baseRoutes,
      '/api/devices': [device],
      '/api/config': config,
      '/api/automations': [],
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Front Door')).toBeInTheDocument())
    expect(screen.getByText('home/front-door')).toBeInTheDocument()
  })

  it('shows empty state when no devices', async () => {
    mockFetch({
      ...baseRoutes,
      '/api/devices': [],
      '/api/config': config,
      '/api/automations': [],
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText(/no devices registered/i)).toBeInTheDocument()
    )
  })
})

describe('Assistant Settings — conversation context timeout', () => {
  it('shows conversationContextTimeoutSeconds from config and saves updated value', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
      }
      const routes: Record<string, unknown> = {
        '/api/voice-nodes': [],
        '/api/logs': [],
        '/api/devices': [],
        '/api/automations': [],
        '/api/config': { autoDiscovery: false, systemName: 'housekeeper', conversationContextTimeoutSeconds: 45 },
      }
      return { ok: true, status: 200, json: async () => routes[url] ?? {}, text: async () => JSON.stringify(routes[url] ?? {}) }
    })
    vi.stubGlobal('fetch', fetchSpy)

    render(<App />)

    await waitFor(() => expect(screen.getByLabelText(/edit assistant settings/i)).toBeInTheDocument())
    await user.click(screen.getByLabelText(/edit assistant settings/i))

    const input = await screen.findByLabelText(/conversation context timeout/i)
    expect(input).toHaveValue(45)

    fireEvent.change(input, { target: { value: '60' } })
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        ([url, init]: [string, RequestInit]) => url === '/api/config' && init?.method === 'PUT'
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall![1].body as string)
      expect(body.conversationContextTimeoutSeconds).toBe(60)
    })
  })
})

describe('Automations', () => {
  it('renders automations list on load', async () => {
    mockFetch({
      ...baseRoutes,
      '/api/devices': [device, actuator],
      '/api/config': config,
      '/api/automations': [automation],
    })

    render(<App />)

    await waitFor(() => expect(screen.getByRole('heading', { name: /devices/i })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /automations/i })).toBeInTheDocument()
    expect(screen.getAllByText('Front Door').length).toBeGreaterThan(0)
  })

  it('shows empty state when no automations', async () => {
    mockFetch({
      ...baseRoutes,
      '/api/devices': [],
      '/api/config': config,
      '/api/automations': [],
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText(/no automations/i)).toBeInTheDocument()
    )
  })
})

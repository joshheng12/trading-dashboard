import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AgentControls from '../AgentControls.vue'
import type { AgentDashboard } from '@/types/agent'

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => MediaQueryList>().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn<MediaQueryList['addListener']>(),
      removeListener: vi.fn<MediaQueryList['removeListener']>(),
      addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
      removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
      dispatchEvent: vi.fn<MediaQueryList['dispatchEvent']>().mockReturnValue(true),
    })),
  )
})
afterEach(() => vi.unstubAllGlobals())

const dashboard = {
  state: {
    status: 'PAUSED',
    mode: 'RESEARCH_ONLY',
    automaticOrders: false,
    emergencyStop: false,
    error: null,
    revision: 0,
  },
  config: {
    enabled: false,
    automaticOrders: false,
    tradingMode: 'paper',
    operatingMode: 'RESEARCH_ONLY',
    stockUniverse: ['AAPL'],
    model: null,
  },
  busy: false,
  decisions: [],
  orders: [],
  events: [],
  scan: null,
  dailyReview: null,
  performance: {
    startingEquity: null,
    currentEquity: null,
    totalReturn: null,
    dailyReturn: null,
    realizedPnl: 0,
    unrealizedPnl: null,
    numberOfTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: null,
    averageWinner: null,
    averageLoser: null,
    profitFactor: null,
    maximumDrawdown: null,
    largestWin: null,
    largestLoss: null,
    botReturn: null,
    spyReturn: null,
    difference: null,
    warnings: [],
    methodology: 'Test metrics',
  },
} satisfies AgentDashboard

describe('agent controls', () => {
  it('shows safe defaults and emits an emergency stop without liquidation', async () => {
    const wrapper = mount(AgentControls, {
      props: { dashboard, researching: false },
      global: { plugins: [PrimeVue] },
    })
    expect(wrapper.text()).toContain('RESEARCH_ONLY')
    expect(wrapper.text()).toContain('OFF')
    const stop = wrapper.findAll('button').find((button) => button.text() === 'Emergency Stop')!
    await stop.trigger('click')
    expect(wrapper.emitted('control')).toEqual([['emergency-stop']])
    expect(wrapper.text()).toContain('does not liquidate positions')
    wrapper.unmount()
  })
  it('keeps research and manual mode controls distinct from automated orders', async () => {
    const wrapper = mount(AgentControls, {
      props: { dashboard, researching: false },
      global: { plugins: [PrimeVue] },
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Run Research Now')!
      .trigger('click')
    expect(wrapper.emitted('run')).toHaveLength(1)
    expect(wrapper.emitted('control')).toBeUndefined()
    wrapper.unmount()
  })
})

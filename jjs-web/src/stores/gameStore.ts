import { create } from 'zustand'
import type { StockInfo, Holding, KlineBar, KlinePeriod } from '@/types'

type SortKey = 'symbol' | 'price' | 'change' | 'volume'

interface GameState {
  wsConnected: boolean
  wsLatency: number
  tickCountdown: number
  currentTick: number
  playerCount: number

  selectedStock: string | null
  stockSortKey: SortKey
  stockSortAsc: boolean
  klinePeriod: KlinePeriod

  stocks: Record<string, StockInfo>
  holdings: Holding[]
  klineData: Record<string, KlineBar[]>

  panels: {
    trade: boolean
    orderBook: boolean
    tradeTape: boolean
    news: boolean
    leaderboard: boolean
    company: boolean
    admin: boolean
    margin: boolean
  }

  setWsConnected: (connected: boolean) => void
  setWsLatency: (ms: number) => void
  setTickCountdown: (n: number) => void
  setCurrentTick: (n: number) => void
  setPlayerCount: (n: number) => void

  selectStock: (symbol: string | null) => void
  setStockSortKey: (key: SortKey) => void
  setKlinePeriod: (period: KlinePeriod) => void

  updateStock: (symbol: string, data: StockInfo) => void
  updateHoldings: (holdings: Holding[]) => void
  setKlineData: (symbol: string, data: KlineBar[]) => void

  togglePanel: (panel: keyof GameState['panels']) => void
  setPanel: (panel: keyof GameState['panels'], visible: boolean) => void
}

export const useGameStore = create<GameState>()((set) => ({
  wsConnected: false,
  wsLatency: 0,
  tickCountdown: 0,
  currentTick: 0,
  playerCount: 0,

  selectedStock: null,
  stockSortKey: 'symbol',
  stockSortAsc: true,
  klinePeriod: '5m',

  stocks: {},
  holdings: [],
  klineData: {},

  panels: {
    trade: true,
    orderBook: true,
    tradeTape: true,
    news: true,
    leaderboard: true,
    company: false,
    admin: false,
    margin: false,
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),
  setWsLatency: (ms) => set({ wsLatency: ms }),
  setTickCountdown: (n) => set({ tickCountdown: n }),
  setCurrentTick: (n) => set({ currentTick: n }),
  setPlayerCount: (n) => set({ playerCount: n }),

  selectStock: (symbol) => set({ selectedStock: symbol }),
  setStockSortKey: (key) =>
    set((s) => ({
      stockSortKey: key,
      stockSortAsc: s.stockSortKey === key ? !s.stockSortAsc : true,
    })),
  setKlinePeriod: (period) => set({ klinePeriod: period }),

  updateStock: (symbol, data) =>
    set((s) => ({ stocks: { ...s.stocks, [symbol]: data } })),
  updateHoldings: (holdings) => set({ holdings }),
  setKlineData: (symbol, data) =>
    set((s) => ({ klineData: { ...s.klineData, [symbol]: data } })),

  togglePanel: (panel) =>
    set((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } })),
  setPanel: (panel, visible) =>
    set((s) => ({ panels: { ...s.panels, [panel]: visible } })),
}))

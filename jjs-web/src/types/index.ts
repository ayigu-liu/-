export interface StockInfo {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  volume: number
  pe: number
  marketCap: number
  sharesOutstanding: number
  eps: number
  tick: number
}

export interface OrderBookLevel {
  price: number
  qty: number
}

export interface OrderBook {
  symbol: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
}

export interface TradeRecord {
  time: string
  symbol: string
  price: number
  qty: number
  direction: 'buy' | 'sell'
}

export interface KlineBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Holding {
  symbol: string
  name: string
  qty: number
  costPrice: number
  currentPrice: number
  marketValue: number
  pnl: number
  pnlPercent: number
}

export interface PortfolioState {
  cash: number
  frozenCash: number
  availableCash: number
  holdings: Holding[]
  totalAssets: number
  totalPnl: number
  totalPnlPercent: number
}

export interface PlayerInfo {
  id: string
  email: string
  nickname: string
  type: 'admin' | 'player' | 'npc'
}

export interface NewsItem {
  id: string
  time: string
  title: string
  content: string
  sentiment: 'bullish' | 'bearish' | 'neutral'
  symbol?: string
}

export interface LeaderboardEntry {
  rank: number
  nickname: string
  totalAssets: number
  pnl: number
  isMe: boolean
}

export interface PendingOrder {
  id: string
  symbol: string
  type: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  price: number | null
  qty: number
  filledQty: number
  status: 'pending' | 'partial' | 'filled' | 'cancelled'
  createdAt: string
}

export interface CompanyState {
  id: string
  symbol: string
  name: string
  industry: Industry
  ceo: string
  tick: number
  quarter: number
  stockPrice: number
  marketCap: number
  cash: number
  revenue: number
  profit: number
  profitMargin: number
  employees: number
  techLevel: number
  sharesOutstanding: number
  eps: number
  pe: number
  ap: number
  maxAp: number
  boardSatisfaction: number
  kpi: KPIState
  cycle: 'boom' | 'normal' | 'recession'
  marketSentiment: number
  actions: ActionDefinition[]
}

export interface KPIState {
  stockGrowth: { current: number; target: number; met: boolean }
  revenueGrowth: { current: number; target: number; met: boolean }
  profitMargin: { current: number; target: number; met: boolean }
  dividendTotal: { current: number; target: number; met: boolean }
  employeeCount: { current: number; target: number; met: boolean }
}

export type Industry = 'tech' | 'finance' | 'manufacturing' | 'energy' | 'consumer' | 'healthcare'

export interface IndustryInfo {
  id: Industry
  name: string
  icon: string
  description: string
  basePE: number
  revenuePerEmployee: number
  startingEmployees: number
  startingCash: number
  sharesOutstanding: number
}

export interface ActionDefinition {
  id: string
  name: string
  category: 'operation' | 'capital' | 'strategic' | 'industry_specific'
  apCost: number
  cashCost: number
  cooldown: number
  cooldownRemaining: number
  maxUses: number | null
  usesRemaining: number | null
  description: string
  available: boolean
}

export interface QuarterlyReport {
  quarter: number
  revenue: number
  profit: number
  profitMargin: number
  eps: number
  stockPrice: number
  employees: number
  techLevel: number
  cash: number
  events: string[]
}

export interface RandomEvent {
  id: string
  title: string
  description: string
  impact: string
  type: 'positive' | 'negative' | 'neutral'
}

export interface MarginAccount {
  totalAssets: number
  totalDebt: number
  marginRatio: number
  status: 'safe' | 'normal' | 'warning' | 'danger'
  shortPositions: ShortPosition[]
  borrowLimit: number
  usedBorrow: number
}

export interface ShortPosition {
  symbol: string
  qty: number
  costPrice: number
  currentPrice: number
  marketValue: number
  pnl: number
  pnlPercent: number
}

export interface WsMessage {
  type: WsMessageType
  data: unknown
}

export type WsMessageType =
  | 'join'
  | 'price_update'
  | 'portfolio_update'
  | 'orderbook'
  | 'trade_tape'
  | 'news'
  | 'quarterly_report'
  | 'company_update'
  | 'leaderboard_update'
  | 'event_notification'
  | 'order_update'
  | 'error'

export type KlinePeriod = '1m' | '5m' | '15m' | '30m' | '60m' | '1d'

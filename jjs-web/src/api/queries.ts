import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { api } from './client'
import type {
  StockInfo,
  KlineBar,
  KlinePeriod,
  LeaderboardEntry,
  NewsItem,
  PortfolioState,
  CompanyState,
  QuarterlyResponse,
  PendingOrder,
  IndustryInfo,
  PlayerBasicInfo,
} from '@/types'

export const stockKeys = {
  all: ['stocks'] as const,
  detail: (symbol: string) => ['stocks', symbol] as const,
  kline: (symbol: string, period: KlinePeriod) => ['kline', symbol, period] as const,
}

export const companyKeys = {
  all: ['companies'] as const,
  state: ['company', 'state'] as const,
  quarterly: ['company', 'quarterly'] as const,
  board: ['company', 'board'] as const,
  industries: ['industries'] as const,
  ipoStatus: ['company', 'ipo', 'status'] as const,
}

export const portfolioKeys = {
  all: ['portfolio'] as const,
  orders: ['orders'] as const,
}

export const marketKeys = {
  leaders: ['leaderboard'] as const,
  news: ['news'] as const,
}

export const playerKeys = {
  info: ['player', 'info'] as const,
}

export function useStockList() {
  return useQuery<StockInfo[]>({
    queryKey: stockKeys.all,
    queryFn: () => api.get('/market/stocks'),
  })
}

export function useStockDetail(symbol: string | null) {
  return useQuery<StockInfo>({
    queryKey: stockKeys.detail(symbol ?? ''),
    queryFn: () => api.get(`/market/stock/${symbol}`),
    enabled: !!symbol,
  })
}

export function useKlineData(symbol: string | null, period: KlinePeriod) {
  return useQuery<KlineBar[]>({
    queryKey: stockKeys.kline(symbol ?? '', period),
    queryFn: () => api.get(`/market/kline/${symbol}?period=${period}`),
    enabled: !!symbol,
  })
}

export function useCompanyState() {
  return useQuery<CompanyState>({
    queryKey: companyKeys.state,
    queryFn: () => api.get('/company/state'),
  })
}

export interface IpoConditionItem {
  met: boolean
  current: number
  required: number
}

export interface IpoStatusInfo {
  eligible: boolean
  conditions: {
    ipo_quarter: number
    listed?: boolean
    quarters: IpoConditionItem
    consecutive_profit: IpoConditionItem
    cash: IpoConditionItem
    annual_revenue: IpoConditionItem
    detail: { nav: number; eps: number; pe: number }
  }
}

export function useIpoStatus() {
  return useQuery<IpoStatusInfo>({
    queryKey: companyKeys.ipoStatus,
    queryFn: () => api.get('/company/ipo/status'),
    refetchInterval: 30_000,
  })
}

export function useQuarterlyReports() {
  return useInfiniteQuery<QuarterlyResponse>({
    queryKey: companyKeys.quarterly,
    queryFn: ({ pageParam }) =>
      api.get(`/company/quarterly?cursor=${pageParam ?? 0}&limit=50`),
    initialPageParam: 0,
    staleTime: 30_000,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined
      const items = lastPage.items
      if (items.length === 0) return undefined
      return items[items.length - 1].quarter
    },
  })
}

export function useBoardState() {
  return useQuery<{ satisfaction: number }>({
    queryKey: companyKeys.board,
    queryFn: () => api.get('/company/board'),
  })
}

export function useIndustries() {
  return useQuery<IndustryInfo[]>({
    queryKey: companyKeys.industries,
    queryFn: () => api.get('/company/industries'),
  })
}

export function usePortfolio() {
  return useQuery<PortfolioState>({
    queryKey: portfolioKeys.all,
    queryFn: () => api.get('/portfolio'),
  })
}

export function usePendingOrders() {
  return useQuery<PendingOrder[]>({
    queryKey: portfolioKeys.orders,
    queryFn: () => api.get('/trade/orders'),
  })
}

export function useLeaderboard() {
  return useQuery<LeaderboardEntry[]>({
    queryKey: marketKeys.leaders,
    queryFn: () => api.get('/leaderboard'),
  })
}

export function usePlayerInfo() {
  return useQuery<PlayerBasicInfo>({
    queryKey: playerKeys.info,
    queryFn: () => api.get('/player/info'),
  })
}

export function useMarketNews() {
  return useQuery<NewsItem[]>({
    queryKey: marketKeys.news,
    queryFn: () => api.get('/market/news'),
  })
}

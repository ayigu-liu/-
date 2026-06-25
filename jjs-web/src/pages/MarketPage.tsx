import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { api } from '@/api/client'
import { ws } from '@/api/ws'
import { useGameStore } from '@/stores/gameStore'
import { TradeForm } from '@/components/TradeForm'
import { KlineChart, type ChartType } from '@/components/KlineChart'
import { Panel } from '@/components/Panel'
import type { StockDetailResponse, KlineBar, StockInfo } from '@/types'

interface StockListResponse {
  stocks: {
    id: number
    symbol: string
    current_price: number
    change: number
    change_percent: number
    open: number
    high: number
    low: number
  }[]
}

interface KlineResponse {
  candles: KlineBar[]
}

const PERIODS = ['15t', '60t', '150t'] as const
type Period = (typeof PERIODS)[number]

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

function formatPercent(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M'
  if (vol >= 1_000) return (vol / 1_000).toFixed(0) + 'K'
  return String(vol)
}

export function MarketPage() {
  const search = useSearch({ from: '/game/market' }) as { symbol?: string }

  const { data: listResp } = useQuery<StockListResponse>({
    queryKey: ['stocks', '150t'],
    queryFn: () => api.get('/market/stocks?period=150t'),
  })
  const rawStocks = listResp?.stocks ?? []

  const wsStocks = useGameStore((s) => s.stocks)

  const stocks = useMemo(() => {
    return rawStocks.map((s) => {
      const ws = wsStocks[s.symbol]
      const price = ws?.price ?? s.current_price
      const periodOpen = s.open
      const change = periodOpen > 0 ? price - periodOpen : (ws?.change ?? s.change)
      const changePercent = periodOpen > 0 ? (change / periodOpen) * 100 : (ws?.changePercent ?? s.change_percent)
      return {
        symbol: s.symbol,
        name: ws?.name ?? s.symbol,
        price,
        change,
        changePercent,
        marketCap: ws?.marketCap ?? 0,
        sharesOutstanding: ws?.sharesOutstanding ?? 0,
      }
    })
  }, [rawStocks, wsStocks])

  const selectedSymbol = useGameStore((s) => s.selectedStock)
  const selectStock = useGameStore((s) => s.selectStock)
  const [sortKey, setSortKey] = useState<'symbol' | 'price' | 'changePercent'>('symbol')
  const [sortAsc, setSortAsc] = useState(true)
  const [period, setPeriod] = useState<Period>('60t')
  const [chartType, setChartType] = useState<ChartType>('candle')
  const [tickBuffer, setTickBuffer] = useState<{ time: number; value: number }[]>([])
  const [showMobileChart, setShowMobileChart] = useState(!!search.symbol)

  const effectivePeriod: Period = chartType === 'realtime' ? '150t' : period

  useEffect(() => {
    if (!selectedSymbol) {
      setTickBuffer([])
      return
    }
    setTickBuffer([])
    const unsub = ws.on('price_update', (msg) => {
      const stocks = (msg.data as Record<string, StockInfo>)
      const s = stocks[selectedSymbol]
      if (s && s.price) {
        setTickBuffer((prev) => {
          const next = [...prev, { time: Date.now() / 1000, value: s.price / 100 }]
          return next.length > 300 ? next.slice(-300) : next
        })
      }
    })
    return unsub
  }, [selectedSymbol])

  const sortedStocks = useMemo(() => {
    const sorted = [...stocks].sort((a, b) => {
      const av = a[sortKey === 'changePercent' ? 'changePercent' : sortKey]
      const bv = b[sortKey === 'changePercent' ? 'changePercent' : sortKey]
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return sorted
  }, [stocks, sortKey, sortAsc])

  const { data: detail } = useQuery<StockDetailResponse>({
    queryKey: ['stockDetail', selectedSymbol],
    queryFn: () => api.get(`/market/stock/${selectedSymbol}`),
    enabled: !!selectedSymbol,
  })

  const { data: klineResp } = useQuery<KlineResponse>({
    queryKey: ['kline', selectedSymbol, effectivePeriod],
    queryFn: () => api.get(`/market/kline/${selectedSymbol}?period=${effectivePeriod}`),
    enabled: !!selectedSymbol,
  })
  const klineData = klineResp?.candles ?? []

  const periodStats = useMemo(() => {
    if (!klineData.length) return null
    const sorted = [...klineData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const firstOpen = sorted[0].open
    const periodHigh = Math.max(...sorted.map((d) => d.high))
    const periodLow = Math.min(...sorted.map((d) => d.low))
    const periodVolume = sorted.reduce((sum, d) => sum + d.volume, 0)
    return { open: firstOpen, high: periodHigh, low: periodLow, volume: periodVolume }
  }, [klineData])

  const currentWs = selectedSymbol ? wsStocks[selectedSymbol] : null
  const currentPrice = currentWs?.price ?? detail?.current_price ?? 0
  const detailName = currentWs?.name ?? detail?.name ?? selectedSymbol ?? ''

  useEffect(() => {
    if (search.symbol) {
      selectStock(search.symbol)
      setShowMobileChart(true)
    }
  }, [search.symbol, selectStock])

  const navigate = useNavigate()

  const handleStockClick = (symbol: string) => {
    selectStock(symbol)
    setShowMobileChart(true)
    navigate({ to: '/game/market', search: { symbol } })
  }

  const handleBack = () => {
    setShowMobileChart(false)
    selectStock(null)
    navigate({ to: '/game/market' })
  }

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const SortArrow = ({ col }: { col: typeof sortKey }) => {
    if (sortKey !== col) return null
    return <span className="ml-0.5 text-accent-blue">{sortAsc ? '↑' : '↓'}</span>
  }

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(220px,340px)_1fr] gap-3">
      <div className={`${showMobileChart ? 'hidden' : ''} lg:flex w-full flex flex-col min-h-0 max-h-[35vh] lg:max-h-none`}>
        <Panel title="股票列表" className="flex-1 flex flex-col min-h-0">
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-text-muted">
                  <th
                    className="text-left py-2 px-2 cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort('symbol')}
                  >
                    代码<SortArrow col="symbol" />
                  </th>
                  <th
                    className="text-right py-2 px-2 cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort('price')}
                  >
                    最新<SortArrow col="price" />
                  </th>
                  <th
                    className="text-right py-2 px-2 cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort('changePercent')}
                  >
                    涨跌<SortArrow col="changePercent" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedStocks.map((s) => {
                  const isUp = s.changePercent >= 0
                  const isSelected = s.symbol === selectedSymbol
                  return (
                    <tr
                      key={s.symbol}
                      className={`cursor-pointer border-b border-border/40 hover:bg-white/[0.03] transition-colors ${
                        isSelected ? 'bg-accent-blue/10' : ''
                      }`}
                      onClick={() => handleStockClick(s.symbol)}
                    >
                      <td className="py-1.5 px-2">
                        <div className="font-medium text-text-primary">{s.symbol}</div>
                        <div className="text-[10px] text-text-muted truncate max-w-[80px]">{s.name || s.symbol}</div>
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono text-text-primary">
                        {formatPrice(s.price)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono ${isUp ? 'text-up' : 'text-down'}`}>
                        {formatPercent(s.changePercent)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className={`${!showMobileChart ? 'hidden' : ''} lg:flex flex flex-col gap-3 min-h-0 overflow-y-auto lg:overflow-visible`}>
        {!selectedSymbol ? (
          <Panel title="股票详情" className="flex-1">
            <div className="p-10 text-center text-text-muted text-sm">选择一个股票查看详情和K线图</div>
          </Panel>
        ) : (
          <>
            <Panel
              title={detailName}
              className="flex-1 flex flex-col min-h-0 overflow-hidden min-h-[420px]"
              headerPrefix={
                <button
                  className="lg:hidden text-accent-blue hover:text-blue-300"
                  onClick={handleBack}
                >
                  ←
                </button>
              }
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs flex-wrap">
                  <span className="text-text-muted">最新</span>
                  <span className={`font-mono font-bold ${((periodStats ? (currentPrice - periodStats.open) : (detail?.change ?? 0)) >= 0) ? 'text-up' : 'text-down'}`}>
                    {formatPrice(currentPrice)}
                  </span>
                  {(periodStats || detail) && (
                    <>
                      {periodStats && (
                        <span className="text-text-muted">
                          开 {formatPrice(periodStats.open)} 高 {formatPrice(periodStats.high)} 低 {formatPrice(periodStats.low)} 量 {formatVolume(periodStats.volume)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className={`px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs rounded transition-colors ${
                      chartType === 'realtime' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'
                    }`}
                    onClick={() => setChartType('realtime')}
                  >
                    实时
                  </button>
                  <button
                    className={`px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs rounded transition-colors ${
                      chartType === 'line' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'
                    }`}
                    onClick={() => setChartType('line')}
                  >
                    分时
                  </button>
                  <button
                    className={`px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs rounded transition-colors ${
                      chartType === 'candle' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'
                    }`}
                    onClick={() => setChartType('candle')}
                  >
                    K线
                  </button>
                  <span className="text-border mx-0.5">|</span>
                  {chartType !== 'realtime' && PERIODS.map((p) => (
                    <button
                      key={p}
                      className={`px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs rounded transition-colors ${
                        period === p ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'
                      }`}
                      onClick={() => setPeriod(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {klineData.length > 0 ? (
                  <KlineChart data={klineData} period={period} chartType={chartType} tickData={tickBuffer} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted text-sm" style={{ minHeight: 400 }}>
                    加载中...
                  </div>
                )}
              </div>
            </Panel>

            <div className="flex flex-col lg:flex-row gap-3">
              {detail && (
                <div className="flex-1">
                  <Panel title="五档盘口" className="h-full">
                    <div className="flex flex-col text-xs font-mono p-2">
                      {detail.asks.slice(0, 5).reverse().map((l, i) => (
                        <div key={`ask-${i}`} className="flex justify-between py-0.5">
                          <span className="text-down">卖{5 - i}</span>
                          <span className="text-text-muted">{formatPrice(l.price)}</span>
                          <span className="text-text-secondary">{l.volume.toLocaleString()}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-1 border-y border-border my-1">
                        <span className="text-text-muted">---</span>
                        <span className="font-bold text-text-primary">{formatPrice(currentPrice)}</span>
                        <span className="text-text-muted">---</span>
                      </div>
                      {detail.bids.slice(0, 5).map((l, i) => (
                        <div key={`bid-${i}`} className="flex justify-between py-0.5">
                          <span className="text-up">买{i + 1}</span>
                          <span className="text-text-muted">{formatPrice(l.price)}</span>
                          <span className="text-text-secondary">{l.volume.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              <div className="flex-1">
                <Panel title="交易" className="h-full">
                  <div className="p-3">
                    <TradeForm
                      symbol={selectedSymbol}
                      currentPrice={currentPrice}
                      bidPrice={detail?.bids[0]?.price}
                      askPrice={detail?.asks[0]?.price}
                      onSuccess={() => {}}
                    />
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

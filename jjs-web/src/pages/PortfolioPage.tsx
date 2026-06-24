import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useGameStore } from '@/stores/gameStore'
import { Panel } from '@/components/Panel'
import { portfolioKeys } from '@/api/queries'

interface BackendHolding {
  stock_id: number
  symbol: string
  qty: number
  avg_cost: number
  frozen_qty: number
  current_price: number
  market_value: number
  profit_loss: number
}

interface PortfolioResponse {
  cash: number
  frozen_cash: number
  holdings: BackendHolding[]
  total_value: number
}

interface BackendOrder {
  id: number
  stock_id: number
  symbol?: string
  type: string
  side: string
  price: number
  qty: number
  filled_qty: number
  status: string
  created_at: string
}

interface OrdersResponse {
  orders: BackendOrder[]
}

function fmtYuan(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function statusLabel(s: string): string {
  switch (s) {
    case 'open': return '待成交'
    case 'partial': return '部分成交'
    case 'filled': return '已成交'
    case 'cancelled': return '已撤销'
    default: return s
  }
}

export function PortfolioPage() {
  const navigate = useNavigate()
  const selectStock = useGameStore((s) => s.selectStock)
  const queryClient = useQueryClient()
  const wsStocks = useGameStore((s) => s.stocks)

  const { data: portfolio } = useQuery<PortfolioResponse>({
    queryKey: portfolioKeys.all,
    queryFn: () => api.get('/portfolio'),
  })

  const { data: ordersResp } = useQuery<OrdersResponse>({
    queryKey: portfolioKeys.orders,
    queryFn: () => api.get('/trade/orders'),
  })

  const orders = ordersResp?.orders ?? []

  const totalMarketValue = portfolio
    ? portfolio.holdings.reduce((sum, h) => {
        const ws = wsStocks[h.symbol]
        const price = ws?.price ?? h.current_price
        return sum + price * h.qty
      }, 0)
    : 0

  const totalPnl = portfolio
    ? portfolio.holdings.reduce((sum, h) => {
        const ws = wsStocks[h.symbol]
        const price = ws?.price ?? h.current_price
        return sum + (price - h.avg_cost) * h.qty
      }, 0)
    : 0

  const totalValue = (portfolio?.cash ?? 0) + totalMarketValue / 100

  const handleCancel = async (orderId: number) => {
    try {
      await api.delete('/trade/order', { order_id: orderId })
      queryClient.invalidateQueries({ queryKey: portfolioKeys.orders })
      queryClient.invalidateQueries({ queryKey: portfolioKeys.all })
    } catch {
      // error is handled by api client
    }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Panel title="总资产" className="bg-bg-card">
          <div className="px-3 py-2 text-lg font-bold text-text-primary font-mono">
            ¥{fmtYuan(totalValue)}
          </div>
        </Panel>
        <Panel title="现金" className="bg-bg-card">
          <div className="px-3 py-2 text-lg font-bold text-accent-gold font-mono">
            ¥{fmtYuan(portfolio?.cash ?? 0)}
          </div>
        </Panel>
        <Panel title="持仓市值" className="bg-bg-card">
          <div className="px-3 py-2 text-lg font-bold text-accent-blue font-mono">
            ¥{fmtYuan(totalMarketValue / 100)}
          </div>
        </Panel>
        <Panel title="浮动盈亏" className="bg-bg-card">
          <div className={`px-3 py-2 text-lg font-bold font-mono ${totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
            {fmtPct(totalPnl / (totalMarketValue - totalPnl) * 100 || 0)}
          </div>
        </Panel>
      </div>

      <Panel
        title="持仓"
        headerAction={
          <span className="text-text-muted font-normal text-[10px]">
            点击跳转交易
          </span>
        }
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="overflow-auto flex-1">
          {(!portfolio?.holdings || portfolio.holdings.length === 0) ? (
            <div className="p-8 text-center text-text-muted text-sm">暂无持仓</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-text-muted">
                  <th className="text-left py-2 px-2">股票</th>
                  <th className="text-right py-2 px-2">持有</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">均价</th>
                  <th className="text-right py-2 px-2">现价</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">市值</th>
                  <th className="text-right py-2 px-2">盈亏</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">盈亏%</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => {
                  const ws = wsStocks[h.symbol]
                  const price = ws?.price ?? h.current_price
                  const mv = price * h.qty
                  const pnl = (price - h.avg_cost) * h.qty
                  const pnlPct = h.avg_cost > 0 ? ((price - h.avg_cost) / h.avg_cost) * 100 : 0
                  const isUp = pnl >= 0

                  return (
                    <tr
                      key={h.symbol}
                      className="cursor-pointer border-b border-border/40 hover:bg-white/[0.03] transition-colors"
                      onClick={() => {
                        selectStock(h.symbol)
                        navigate({ to: '/game/market', search: { symbol: h.symbol } })
                      }}
                    >
                      <td className="py-1.5 px-2">
                        <span className="text-text-primary font-medium">{h.symbol}</span>
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono text-text-primary">{h.qty.toLocaleString()}</td>
                      <td className="text-right py-1.5 px-2 font-mono text-text-muted hidden sm:table-cell">
                        {fmtYuan(h.avg_cost / 100)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono ${isUp ? 'text-up' : 'text-down'}`}>
                        {fmtYuan(price / 100)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono text-text-secondary hidden sm:table-cell">
                        {fmtYuan(mv / 100)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono ${isUp ? 'text-up' : 'text-down'}`}>
                        {pnl >= 0 ? '+' : ''}{fmtYuan(pnl / 100)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono hidden sm:table-cell ${isUp ? 'text-up' : 'text-down'}`}>
                        {fmtPct(pnlPct)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      <Panel title="挂单" className="flex-1 flex flex-col min-h-0">
        <div className="overflow-auto flex-1">
          {orders.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">暂无挂单</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-text-muted">
                  <th className="text-left py-2 px-2">股票</th>
                  <th className="text-left py-2 px-2">方向</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">价格</th>
                  <th className="text-right py-2 px-2">数量</th>
                  <th className="text-right py-2 px-2">已成交</th>
                  <th className="text-center py-2 px-2 hidden sm:table-cell">状态</th>
                  <th className="text-center py-2 px-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border/40">
                    <td className="py-1.5 px-2 text-text-primary font-medium">{o.symbol ?? `#${o.stock_id}`}</td>
                    <td className={`py-1.5 px-2 font-bold ${o.side === 'buy' ? 'text-up' : 'text-down'}`}>
                      {o.side === 'buy' ? '买入' : '卖出'}
                    </td>
                    <td className="text-right py-1.5 px-2 font-mono text-text-muted hidden sm:table-cell">
                      {o.price > 0 ? fmtYuan(o.price / 100) : '市价'}
                    </td>
                    <td className="text-right py-1.5 px-2 font-mono text-text-primary">{o.qty.toLocaleString()}</td>
                    <td className="text-right py-1.5 px-2 font-mono text-text-secondary">{o.filled_qty.toLocaleString()}</td>
                    <td className="text-center py-1.5 px-2 hidden sm:table-cell">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        o.status === 'open' ? 'bg-accent-blue/20 text-accent-blue' :
                        o.status === 'partial' ? 'bg-accent-gold/20 text-accent-gold' :
                        'bg-text-muted/20 text-text-muted'
                      }`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="text-center py-1.5 px-2">
                      {(o.status === 'open' || o.status === 'partial') && (
                        <button
                          className="text-[10px] text-accent-red hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCancel(o.id)
                          }}
                        >
                          撤单
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </div>
  )
}

import { useEffect } from 'react'
import { Header } from '@/components/Header'
import { useGameStore } from '@/stores/gameStore'
import { ws } from '@/api/ws'
import { usePlayerInfo } from '@/api/queries'
import type { WsMessage, StockInfo } from '@/types'

interface HoldingsUpdate {
  holdings: import('@/types').Holding[]
}

export function GamePage() {
  const { data: playerInfo } = usePlayerInfo()
  const setTickCountdown = useGameStore((s) => s.setTickCountdown)
  const setCurrentTick = useGameStore((s) => s.setCurrentTick)
  const updateStock = useGameStore((s) => s.updateStock)
  const updateHoldings = useGameStore((s) => s.updateHoldings)

  useEffect(() => {
    ws.connect()

    const unsubPrice = ws.on('price_update', (msg: WsMessage) => {
      const stocks = msg.data as Record<string, StockInfo>
      for (const [symbol, data] of Object.entries(stocks)) {
        updateStock(symbol, data)
      }
      setCurrentTick((msg.data as { tick: number }).tick ?? 0)
    })

    const unsubPortfolio = ws.on('portfolio_update', (msg: WsMessage) => {
      const data = msg.data as HoldingsUpdate
      if (data.holdings) {
        updateHoldings(data.holdings)
      }
    })

    return () => {
      unsubPrice()
      unsubPortfolio()
      ws.disconnect()
    }
  }, [setTickCountdown, setCurrentTick, updateStock, updateHoldings])

  return (
    <div className="flex flex-col h-screen">
      <Header cash={playerInfo?.cash} nickname={playerInfo?.nickname} />

      <div className="flex-1 grid grid-cols-[1fr_260px] gap-3 p-3 overflow-hidden">
        {/* Left: K-line + Trading */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <Panel title="股票详情" className="flex-1">
            <div className="p-10 text-center text-text-muted text-sm">
              选择一个股票查看详情和 K 线图
            </div>
          </Panel>
          <Panel title="交易">
            <div className="p-10 text-center text-text-muted text-sm">
              交易面板（P7 阶段实现）
            </div>
          </Panel>
        </div>

        {/* Right: Portfolio + Leaderboard */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <Panel title="持仓">
            <div className="p-8 text-center text-text-muted text-sm">
              暂无持仓
            </div>
          </Panel>
          <Panel title="排行榜">
            <div className="p-8 text-center text-text-muted text-sm">
              加载中...
            </div>
          </Panel>
        </div>
      </div>

      {/* Floating panels placeholder */}
      <FloatingPanels />
    </div>
  )
}

function Panel({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-bg-card rounded border border-border shadow-sm hover:border-border-light transition-colors overflow-hidden ${className}`}
    >
      <div className="px-3.5 py-2.5 text-xs font-bold text-text-secondary border-b border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)] tracking-wider">
        {title}
      </div>
      {children}
    </div>
  )
}

function FloatingPanels() {
  const panels = useGameStore((s) => s.panels)

  if (!panels.trade && !panels.orderBook && !panels.tradeTape && !panels.news && !panels.leaderboard) {
    return null
  }

  return (
    <div className="fixed top-20 right-5 space-y-3 z-50">
      {panels.orderBook && (
        <FloatingPanel title="盘口" panelKey="orderBook" className="w-72">
          <div className="p-6 text-center text-text-muted text-xs">暂无数据</div>
        </FloatingPanel>
      )}
      {panels.tradeTape && (
        <FloatingPanel title="逐笔成交" panelKey="tradeTape" className="w-72">
          <div className="p-6 text-center text-text-muted text-xs">暂无数据</div>
        </FloatingPanel>
      )}
      {panels.news && (
        <FloatingPanel title="市场新闻" panelKey="news" className="w-72">
          <div className="p-6 text-center text-text-muted text-xs">暂无新闻</div>
        </FloatingPanel>
      )}
      {panels.leaderboard && (
        <FloatingPanel title="排行榜" panelKey="leaderboard" className="w-72">
          <div className="p-6 text-center text-text-muted text-xs">加载中...</div>
        </FloatingPanel>
      )}
    </div>
  )
}

function FloatingPanel({
  title,
  panelKey,
  children,
  className = '',
}: {
  title: string
  panelKey: 'trade' | 'orderBook' | 'tradeTape' | 'news' | 'leaderboard' | 'company' | 'admin' | 'margin'
  children: React.ReactNode
  className?: string
}) {
  const togglePanel = useGameStore((s) => s.togglePanel)

  return (
    <div className={`bg-bg-card border border-border-light rounded shadow-lg ${className} animate-ftp-in`}>
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-header border-b border-border">
        <span className="text-[13px] font-bold tracking-wide">{title}</span>
        <button
          onClick={() => togglePanel(panelKey)}
          className="bg-white/5 border border-border text-text-muted px-1.5 py-0.5 text-xs rounded transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto max-h-80">{children}</div>
    </div>
  )
}

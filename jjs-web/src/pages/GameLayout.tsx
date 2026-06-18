import { useEffect } from 'react'
import { Outlet } from '@tanstack/react-router'
import { Header } from '@/components/Header'
import { Dock } from '@/components/Dock'
import { useGameStore } from '@/stores/gameStore'
import { ws } from '@/api/ws'
import { usePlayerInfo } from '@/api/queries'
import type { WsMessage, StockInfo } from '@/types'

interface HoldingsUpdate {
  holdings: import('@/types').Holding[]
}

export function GameLayout() {
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
      <Header cash={playerInfo?.cash} nickname={playerInfo?.nickname} globalQuarter={playerInfo?.global_quarter} />
      <main className="flex-1 overflow-y-auto p-3">
        <Outlet />
      </main>
      <Dock />
    </div>
  )
}

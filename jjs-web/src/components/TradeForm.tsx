import { useState } from 'react'
import { api } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { portfolioKeys } from '@/api/queries'
import type { PlaceOrderRequest, PlaceOrderResponse } from '@/types'

interface TradeFormProps {
  symbol: string
  currentPrice: number       // 分
  bidPrice?: number          // 买一价 (分)
  askPrice?: number          // 卖一价 (分)
  maxBuyQty?: number
  maxSellQty?: number
  onSuccess?: () => void
}

export function TradeForm({ symbol, currentPrice, bidPrice, askPrice, maxBuyQty, maxSellQty, onSuccess }: TradeFormProps) {
  const queryClient = useQueryClient()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PlaceOrderResponse | null>(null)

  const isBuy = side === 'buy'
  const priceColor = isBuy ? 'text-up' : 'text-down'
  const btnBg = isBuy ? 'bg-up hover:bg-red-600' : 'bg-down hover:bg-emerald-600'

  const handleSubmit = async () => {
    setError('')
    setResult(null)
    const qtyNum = parseInt(qty, 10)
    const priceYuan = parseFloat(price)

    if (!qtyNum || qtyNum <= 0) {
      setError('请输入有效数量')
      return
    }
    if (orderType === 'limit' && (!priceYuan || priceYuan <= 0)) {
      setError('请输入有效限价')
      return
    }
    if (orderType === 'limit' && Math.round(priceYuan * 100) < 1) {
      setError('价格不能低于 0.01 元')
      return
    }

    setSubmitting(true)
    try {
      const body: PlaceOrderRequest = {
        symbol,
        type: orderType,
        side,
        price: orderType === 'limit' ? Math.round(priceYuan * 100) : 0,
        qty: qtyNum,
      }
      const res = await api.post<PlaceOrderResponse>('/trade/order', body)
      setResult(res)
      setQty('')
      queryClient.invalidateQueries({ queryKey: portfolioKeys.all })
      queryClient.invalidateQueries({ queryKey: portfolioKeys.orders })
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '下单失败')
    } finally {
      setSubmitting(false)
    }
  }

  const fillPrice = (cents: number | undefined) => {
    if (orderType === 'limit' && cents && cents > 0) {
      setPrice((cents / 100).toString())
    }
  }

  const maxQty = isBuy ? maxBuyQty : maxSellQty

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch rounded bg-bg-input overflow-hidden">
        <button
          className={`flex-1 py-2 text-sm font-bold transition-colors ${isBuy ? 'bg-up text-white' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setSide('buy')}
        >
          买入
        </button>
        <button
          className={`flex-1 py-2 text-sm font-bold transition-colors ${!isBuy ? 'bg-down text-white' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setSide('sell')}
        >
          卖出
        </button>
      </div>

      <div className="flex items-stretch rounded bg-bg-input overflow-hidden">
        <button
          className={`flex-1 py-1.5 text-xs transition-colors ${orderType === 'limit' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setOrderType('limit')}
        >
          限价单
        </button>
        <button
          className={`flex-1 py-1.5 text-xs transition-colors ${orderType === 'market' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setOrderType('market')}
        >
          市价单
        </button>
      </div>

      {orderType === 'limit' && (
        <div>
          <label className="text-xs text-text-muted mb-1 block">限价 (元)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="flex-1 bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent-blue"
              step="0.01"
              min="0.01"
              placeholder={`当前 ${(currentPrice / 100).toFixed(2)}`}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <button
              className="text-xs text-text-muted hover:text-accent-blue px-1"
              onClick={() => fillPrice(isBuy ? askPrice : bidPrice)}
            >
              盘口
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-text-muted mb-1 block">
          数量 (股) {maxQty ? `/ 最多 ${maxQty}` : ''}
        </label>
        <input
          type="number"
          className="w-full bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent-blue"
          placeholder="输入数量"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>

      {orderType === 'limit' && price && qty && (
        <div className="text-xs text-text-muted">
          预估金额：<span className={priceColor}>¥{(parseFloat(price) * parseInt(qty, 10)).toFixed(2)}</span>
        </div>
      )}

      <button
        className={`w-full py-2 rounded font-bold text-sm text-white transition-colors disabled:opacity-50 ${btnBg}`}
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? '提交中...' : isBuy ? '买入' : '卖出'}
      </button>

      {error && (
        <div className="text-xs text-accent-red bg-red-500/10 rounded px-3 py-1.5">{error}</div>
      )}
      {result && (
        <div className="text-xs bg-accent-blue/10 rounded px-3 py-1.5">
          <span className="text-accent-blue">订单已提交</span>
          <span className="text-text-muted ml-2">
            {result.status === 'filled' ? '全部成交' : result.status === 'partial' ? '部分成交' : '已挂单'}
          </span>
          {result.filled_qty > 0 && (
            <span className="text-text-muted ml-1">({result.filled_qty}股已成交)</span>
          )}
        </div>
      )}
    </div>
  )
}

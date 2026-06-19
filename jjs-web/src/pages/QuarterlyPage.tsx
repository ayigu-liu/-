import { useState, useRef, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuarterlyReports } from '@/api/queries'
import { Panel } from '@/components/Panel'
import type { QuarterlyReport } from '@/types'

function formatQuarter(q: number) {
  const year = Math.floor((q - 1) / 4) + 1
  const qnum = ((q - 1) % 4) + 1
  return `${year}年第${qnum}季`
}

function formatRatio(part: number, total: number) {
  if (!total) return '0%'
  return `${(part / total * 100).toFixed(0)}%`
}

export function QuarterlyPage() {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useQuarterlyReports()
  const [selected, setSelected] = useState<QuarterlyReport | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !hasNextPage || isFetchingNextPage) return

    const handleScroll = () => {
      if (container.scrollTop === 0) return
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 100) {
        fetchNextPage()
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-muted">加载中...</p>
      </div>
    )
  }

  const list = data?.pages.flatMap((p) => p.items) ?? []
  const totalHasMore = data?.pages[data.pages.length - 1]?.hasMore ?? false

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3 shrink-0">
        <Link
          to="/game/company"
          className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          ← 返回公司
        </Link>
        <h2 className="text-base font-bold text-text-primary">历史报表</h2>
      </div>

      {list.length === 0 ? (
        <Panel title="季度报表">
          <div className="p-8 text-center text-text-muted text-sm">
            暂无历史季度数据，结算后将自动生成
          </div>
        </Panel>
      ) : (
        <Panel title="季度报表" className="flex-1 min-h-0 flex flex-col">
          <div ref={scrollRef} className="overflow-auto flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border sticky top-0 bg-bg-card">
                  <th className="p-2.5 text-left">季度</th>
                  <th className="p-2.5 text-right">营收</th>
                  <th className="p-2.5 text-right">利润</th>
                  <th className="p-2.5 text-right">总成本</th>
                  <th className="p-2.5 text-right">期初现金</th>
                  <th className="p-2.5 text-right">期末现金</th>
                </tr>
              </thead>
              <tbody>
                {list.map((q) => {
                  return (
                    <tr
                      key={q.ID}
                      className="border-b border-border/50 hover:bg-bg-hover cursor-pointer transition-colors"
                      onClick={() => setSelected(q)}
                    >
                      <td className="p-2.5 text-text-secondary">{formatQuarter(q.quarter)}</td>
                      <td className="p-2.5 text-right text-text-primary">¥{q.revenue.toLocaleString()}</td>
                      <td className={`p-2.5 text-right ${q.profit >= 0 ? 'text-up' : 'text-down'}`}>
                        ¥{q.profit.toLocaleString()}
                      </td>
                      <td className="p-2.5 text-right text-text-primary">¥{q.total_cost.toLocaleString()}</td>
                      <td className="p-2.5 text-right text-text-primary">¥{q.beginning_cash.toLocaleString()}</td>
                      <td className="p-2.5 text-right text-text-primary">¥{q.cash.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-center py-3">
              {isFetchingNextPage && (
                <p className="text-text-muted text-xs">加载更多...</p>
              )}
              {!totalHasMore && list.length > 0 && (
                <p className="text-text-muted text-xs">已加载全部</p>
              )}
            </div>
          </div>
        </Panel>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">
                {formatQuarter(selected.quarter)} 财报详情
              </h3>
              <button
                className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              <section>
                <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">财务摘要</div>
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="营收" value={`¥${selected.revenue.toLocaleString()}`} />
                  <DetailItem label="利润" value={`¥${selected.profit.toLocaleString()}`} positive={selected.profit >= 0} />
                  <DetailItem label="支出" value={`¥${selected.total_cost.toLocaleString()}`} />
                  <DetailItem label="期末现金" value={`¥${selected.cash.toLocaleString()}`} />
                </div>
              </section>

              <section>
                <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">支出明细</div>
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="人力支出" value={`¥${selected.labor_cost.toLocaleString()}`} hint={`${formatRatio(selected.labor_cost, selected.total_cost)}`} />
                  <DetailItem label="基础维护支出" value={`¥${selected.base_maintenance.toLocaleString()}`} hint={`${formatRatio(selected.base_maintenance, selected.total_cost)}`} />
                  <DetailItem label="运营支出" value={`¥${selected.operational_cost.toLocaleString()}`} hint={`${formatRatio(selected.operational_cost, selected.total_cost)}`} />
                  <DetailItem label="仓储支出" value={`¥${selected.warehouse_cost.toLocaleString()}`} hint={`${formatRatio(selected.warehouse_cost, selected.total_cost)}`} />
                </div>
              </section>

              <section>
                <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">运营指标</div>
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="员工" value={`${selected.employees}人`} />
                  <DetailItem label="产线" value={`${selected.cap_count}条`} />
                  <DetailItem label="开工产能" value={`${Math.min(selected.employees * 2000, selected.cap_count * 10000).toLocaleString()}件/季`} />
                  <DetailItem label="产能上限" value={`${(selected.cap_count * 10000).toLocaleString()}件/季`} />
                  <DetailItem label="产量" value={`${selected.prod_qty.toLocaleString()}件`} />
                  <DetailItem label="销量" value={`${selected.sales_qty.toLocaleString()}件`} />
                  <DetailItem label="库存变更" value={`${selected.prod_qty - selected.sales_qty >= 0 ? '+' : ''}${(selected.prod_qty - selected.sales_qty).toLocaleString()}件`} positive={selected.prod_qty - selected.sales_qty >= 0} />
                  <DetailItem label="库存" value={selected.inventory > 0 ? `${selected.inventory.toLocaleString()}件` : '—'} />
                </div>
              </section>

              <section>
                <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">股权数据</div>
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="总股本" value={`${selected.total_shares.toLocaleString()}股`} />
                  <DetailItem label="CEO持股" value={`${selected.ceo_shares.toLocaleString()}股 (${(selected.ceo_shares / selected.total_shares * 100).toFixed(0)}%)`} />
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, positive, hint }: {
  label: string
  value: string
  positive?: boolean
  hint?: string
}) {
  return (
    <div className="bg-bg-input rounded p-2.5">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${
        positive === undefined ? 'text-text-primary' : positive ? 'text-up' : 'text-down'
      }`}>
        {value}
        {hint && <span className="text-text-muted text-[11px] ml-1.5">({hint})</span>}
      </div>
    </div>
  )
}

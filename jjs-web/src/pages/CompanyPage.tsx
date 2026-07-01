import { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/api/client'
import { useCompanyState, usePlayerInfo, useIpoStatus } from '@/api/queries'
import { Panel } from '@/components/Panel'
import type { ActionResponse } from '@/types'

const INDUSTRY_META: Record<string, { name: string; icon: string; desc: string; enabled: boolean }> = {
  tech:          { name: '科技',     icon: '💻', desc: '技术驱动，重研发投入，设备迭代快', enabled: false },
  finance:       { name: '金融',     icon: '🏦', desc: '资本运作，高杠杆高回报，牌照壁垒高', enabled: false },
  manufacturing: { name: '制造',     icon: '🏭', desc: '产能为王，规模效应，注意库存积压', enabled: true },
  mining:        { name: '矿业',     icon: '⛏️', desc: '探明矿藏，挖一点少一点，价格波动最剧烈', enabled: true },
  consumer:      { name: '消费',     icon: '🛍️', desc: '品牌驱动，营销为王，热度就是生命', enabled: false },
  healthcare:    { name: '医疗',     icon: '💊', desc: '研发周期长，专利护城河，慢热暴利', enabled: false },
}

const CEO_SHARES = 100000
const INVESTOR_SHARES_MIN = 100000
const INVESTOR_SHARES_MAX = 1900000
const INVEST_MIN = 1000

function MetricLabel({ label, value, tooltip }: { label: string; value: string; tooltip: string }) {
  return (
    <div className="bg-bg-input rounded p-2 text-center relative group cursor-help">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="text-xs font-semibold text-text-primary mt-0.5">{value}</div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-bg-input border border-border rounded text-[11px] text-text-secondary whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 pointer-events-none">
        {tooltip}
      </div>
    </div>
  )
}

function ConditionBar({ label, item, suffix, isCurrency }: {
  label: string
  item: { met: boolean; current: number; required: number }
  suffix: string
  isCurrency?: boolean
}) {
  const pct = Math.max(0, Math.min(100, Math.round((item.current / item.required) * 100)))
  const fmt = (n: number) => isCurrency ? `¥${n.toLocaleString()}` : n.toLocaleString()
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-text-secondary">{label}</span>
        <span className={item.met ? 'text-accent-green' : 'text-text-muted'}>
          {fmt(item.current)} / {fmt(item.required)}{isCurrency ? '' : suffix}
        </span>
      </div>
      <div className="h-1.5 bg-bg-card rounded-full overflow-hidden border border-border">
        <div
          className={`h-full rounded-full transition-all ${item.met ? 'bg-accent-green' : 'bg-accent-blue'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function formatQuarter(q: number) {
  const year = Math.floor((q - 1) / 4) + 1
  const qnum = ((q - 1) % 4) + 1
  return `${year}年${qnum}季度`
}

function formatRatio(part: number, total: number) {
  if (!total) return '0%'
  return `${(part / total * 100).toFixed(0)}%`
}

export function CompanyPage() {
  const { data: company, isLoading } = useCompanyState()
  const { data: playerInfo } = usePlayerInfo()
  const { data: ipoStatus } = useIpoStatus()
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [companyName, setCompanyName] = useState('')
  const [investorShares, setInvestorShares] = useState(500000)
  const [playerInvestment, setPlayerInvestment] = useState(50000)
  const [investInitialized, setInvestInitialized] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showQuarterly, setShowQuarterly] = useState(false)
  const [error, setError] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [actionView, setActionView] = useState<'selection' | 'expand' | 'hire' | 'layoff' | 'sell_assets' | 'marketing'>('selection')
  const [actionAmount, setActionAmount] = useState(0)
  const [actionsSubmitted, setActionsSubmitted] = useState(0)
  useEffect(() => {
    if (company?.actions_submitted !== undefined) {
      setActionsSubmitted(company.actions_submitted)
    }
  }, [company?.actions_submitted])

  useEffect(() => {
    if (!investInitialized && playerInfo) {
      const cash = playerInfo.cash ?? 100000
      setPlayerInvestment(prev => Math.min(prev, cash))
      setInvestInitialized(true)
    }
  }, [playerInfo, investInitialized])
  const [submittingActions, setSubmittingActions] = useState(false)
  const [actionError, setActionError] = useState('')
  const queryClient = useQueryClient()

  const playerCash = playerInfo?.cash ?? 100000

  const [showIpo, setShowIpo] = useState(false)
  const [ipoFloatRatio, setIpoFloatRatio] = useState(0.3)
  const [ipoError, setIpoError] = useState('')
  const [submittingIpo, setSubmittingIpo] = useState(false)

  const totalShares = useMemo(() => CEO_SHARES + investorShares, [investorShares])
  const ownRatio = useMemo(() => CEO_SHARES / totalShares, [totalShares])
  const companyCash = useMemo(() => Math.round(playerInvestment / ownRatio), [playerInvestment, ownRatio])

  const selectedMeta = selectedIndustry ? INDUSTRY_META[selectedIndustry] : null
  const industryDisabled = selectedMeta ? !selectedMeta.enabled : false

  const handleCreate = async () => {
    if (!selectedIndustry || !companyName.trim() || industryDisabled) return
    setCreating(true)
    setError('')
    try {
      await api.post('/company/create', {
        name: companyName.trim(),
        industry: selectedIndustry,
        investor_shares: investorShares,
        player_investment: playerInvestment,
      })
      queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleIpo = async () => {
    setSubmittingIpo(true)
    setIpoError('')
    try {
      await api.post('/company/ipo', { float_ratio: ipoFloatRatio })
      queryClient.invalidateQueries({ queryKey: ['company'] })
      setShowIpo(false)
    } catch (err) {
      setIpoError(err instanceof Error ? err.message : 'IPO 失败')
    } finally {
      setSubmittingIpo(false)
    }
  }

  const handleSubmitAction = async (type: 'expand' | 'hire' | 'layoff' | 'sell_assets' | 'marketing', amount: number) => {
    if (!company) return
    setSubmittingActions(true)
    setActionError('')
    try {
      await api.post<ActionResponse>('/company/actions', { actions: [{ type, amount }] })
      setActionsSubmitted(prev => prev + 1)
      setShowActions(false)
      setActionView('selection')
      setActionAmount(0)
      queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmittingActions(false)
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-muted">加载中...</p>
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

  const hasCompany = company && company.id > 0

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text-primary">{hasCompany ? '公司经营' : '创建公司'}</h2>
        <button
          onClick={() => setShowGuide(true)}
          className="text-xs text-text-muted hover:text-accent-blue border border-border rounded px-2 py-0.5 transition-colors"
        >
          ? 玩法说明
        </button>
      </div>

      {!hasCompany ? (
        <div className="space-y-4">
          <div className="-mt-1">
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="给你的公司起个名字"
              maxLength={20}
              className="bg-bg-card"
            />
          </div>

          <Panel title="选择行业">
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(INDUSTRY_META).map(([key, meta]) => (
                  <button
                    key={key}
                    className={`text-left p-3 rounded border transition-colors relative ${
                      selectedIndustry === key
                        ? 'border-accent-blue bg-accent-blue/10'
                        : 'border-border bg-bg-card hover:border-border-light'
                    }`}
                    onClick={() => setSelectedIndustry(key)}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base">{meta.icon}</span>
                      <span className="text-sm font-semibold text-text-primary">{meta.name}</span>
                    </div>
                    <div className="text-[11px] text-text-muted">{meta.desc}</div>
                    {!meta.enabled && (
                      <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-muted">
                        即将开放
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="股权与融资">
            <div className="p-3 space-y-4">
              <div className="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
                <div>
                  <div className="flex justify-between text-xs text-text-secondary mb-1">
                    <span>您投入公司</span>
                    <span className="text-text-primary font-semibold">¥{playerInvestment.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min={INVEST_MIN}
                    max={playerCash}
                    step={1000}
                    value={playerInvestment}
                    onChange={(e) => setPlayerInvestment(Number(e.target.value))}
                    className="w-full accent-accent-blue"
                  />
                  <div className="flex justify-between text-[11px] text-text-muted mt-0.5">
                    <span>¥1,000</span>
                    <span>¥{playerCash.toLocaleString()}</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-text-secondary mb-1">
                    <span>投资方持股</span>
                    <span className="text-text-primary font-semibold">{investorShares.toLocaleString()} 股</span>
                  </div>
                  <input
                    type="range"
                    min={INVESTOR_SHARES_MIN}
                    max={INVESTOR_SHARES_MAX}
                    step={10000}
                    value={investorShares}
                    onChange={(e) => setInvestorShares(Number(e.target.value))}
                    className="w-full accent-accent-blue"
                  />
                  <div className="flex justify-between text-[11px] text-text-muted mt-0.5">
                    <span>10万</span>
                    <span>190万</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-bg-card rounded p-2 border border-border">
                  <div className="text-[11px] text-text-muted">您的持股</div>
                  <div className="text-sm font-semibold text-accent-blue">{CEO_SHARES.toLocaleString()} 股</div>
                </div>
                <div className="bg-bg-card rounded p-2 border border-border">
                  <div className="text-[11px] text-text-muted">出资比例</div>
                  <div className="text-sm font-semibold text-accent-green">{(ownRatio * 100).toFixed(1)}%</div>
                </div>
                <div className="bg-bg-card rounded p-2 border border-border">
                  <div className="text-[11px] text-text-muted">公司初始资金</div>
                  <div className="text-sm font-semibold text-accent-gold">¥{companyCash.toLocaleString()}</div>
                </div>
              </div>

              {error && <p className="text-accent-red text-sm">{error}</p>}
              <button
                className="btn btn-primary btn-full"
                disabled={!selectedIndustry || !companyName.trim() || creating || industryDisabled}
                onClick={handleCreate}
              >
                {!selectedIndustry
                  ? '请选择行业'
                  : industryDisabled
                  ? '该行业暂未开放'
                  : creating
                  ? '创建中...'
                  : '创建公司'}
              </button>
            </div>
          </Panel>
        </div>
      ) : (() => {
          const confirmedQ = company.last_quarterly
          const invDelta = confirmedQ ? confirmedQ.prod_qty - confirmedQ.sales_qty : 0
          const isMfg = company.industry === 'manufacturing'
          const expUnitCost = isMfg ? 80000 : 120000
          const hireUnitCost = 3000
          const layoffUnitCost = 7500
          const assetSellPrice = isMfg ? 80000 * 0.75 : 2.0 * 0.75
          const marketingMinPerYuan = isMfg ? 0.075 : 0.125
          const marketingMaxPerYuan = isMfg ? 0.175 : 0.292
          const perWorkerOutput = isMfg ? 2000 : 1500
          const outputUnit = isMfg ? '件' : '单位'

          const mfgLabels = { expand: '新建产线', expandUnit: '条', sellLabel: '出售产线数', sellUnit: '条' }
          const resLabels = { expand: '勘探矿脉', expandUnit: '次', sellLabel: '出售矿权数', sellUnit: '单位' }
          const ind = isMfg ? mfgLabels : resLabels

          const actionConfig: Record<string, { title: string; inputLabel: string; unit: string }> = {
            expand: { title: ind.expand, inputLabel: `${ind.expand}数量`, unit: ind.expandUnit },
            hire: { title: '招募员工', inputLabel: '招募岗位数', unit: '岗位' },
            layoff: { title: '裁员', inputLabel: '裁员人数', unit: '人' },
            sell_assets: { title: '资产处置', inputLabel: ind.sellLabel, unit: ind.sellUnit },
            marketing: { title: '营销推广', inputLabel: '投入金额', unit: '¥' },
          }

          let maxAmount: number
          let cost: number
          let income = 0
          if (actionView === 'expand') {
            maxAmount = Math.floor(company.cash / expUnitCost)
            cost = actionAmount * expUnitCost
          } else if (actionView === 'hire') {
            maxAmount = Math.floor(company.cash / hireUnitCost)
            cost = actionAmount * hireUnitCost
          } else if (actionView === 'layoff') {
            maxAmount = company.employees
            cost = actionAmount * layoffUnitCost
          } else if (actionView === 'sell_assets') {
            maxAmount = company.cap_count
            cost = 0
            income = actionAmount * assetSellPrice
          } else {
            maxAmount = Math.floor(company.cash)
            cost = actionAmount
          }

          const remaining = 3 - actionsSubmitted
          const canSubmit =
            actionView === 'sell_assets' || actionView === 'layoff'
              ? actionAmount > 0 && remaining > 0
              : actionAmount > 0 && cost <= company.cash && remaining > 0

          return (
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-bg-card rounded-lg p-4 border border-border">
            <span className="text-2xl">{INDUSTRY_META[company.industry]?.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-text-primary truncate">{company.name}</div>
              <div className="text-xs text-text-muted">
                {company.symbol} · {INDUSTRY_META[company.industry]?.name}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] text-text-muted">公司现金</div>
              <div className="text-lg font-bold text-accent-blue">¥{company.cash.toLocaleString()}</div>
            </div>
          </div>

          <Panel title="经营指标">
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2">
                {company.industry === 'mining' ? (
                  <>
                    <MetricCard
                      label="矿藏储量"
                      value={`${company.cap_count.toLocaleString()}单位`}
                    />
                    <MetricCard
                      label="季度采掘上限"
                      value={`${company.capacity_ceiling.toLocaleString()}单位/季`}
                      hint="受矿脉丰度与开采枯竭程度影响"
                    />
                    <MetricCard label="员工" value={`${company.employees}人`} />
                    <MetricCard
                      label="有效产量"
                      value={`${company.actual_output.toLocaleString()}单位/季`}
                      hint={`员工 ${company.employees}人 × 1,500单位/人 = ${(company.employees * 1500).toLocaleString()}；受季度上限 ${company.capacity_ceiling.toLocaleString()} 限制`}
                    />
                  </>
                ) : (
                  <>
                    <MetricCard label="生产线" value={`${company.cap_count}条`} />
                    <MetricCard label="员工" value={`${company.employees}人`} />
                    <MetricCard
                      label="有效产能"
                      value={`${company.actual_output.toLocaleString()}件/季`}
                      hint={`员工 ${company.employees}人 × 2,000件/人 = ${company.actual_output.toLocaleString()}件`}
                    />
                    <MetricCard
                      label="产能上限"
                      value={`${company.capacity_ceiling.toLocaleString()}件/季`}
                      hint={`${company.cap_count}条产线 × 10,000件/条 = ${company.capacity_ceiling.toLocaleString()}件`}
                    />
                  </>
                )}
                <MetricCard
                  label="库存"
                  value={company.inventory > 0 ? `${company.inventory.toLocaleString()}${company.industry === 'mining' ? '单位' : '件'}` : '—'}
                  hint={confirmedQ ? `上季产量 ${confirmedQ.prod_qty.toLocaleString()} - 销量 ${confirmedQ.sales_qty.toLocaleString()} = 库存${invDelta >= 0 ? '+' : ''}${invDelta.toLocaleString()}` : undefined}
                />
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => { setShowActions(true); setActionView('selection'); setActionAmount(0); setActionError('') }}
                >
                  ⚡ 经营行动{actionsSubmitted > 0 ? ` (剩余 ${remaining}/3)` : ''}
                </button>
              </div>
            </div>
          </Panel>

          {company.pending_orders.length > 0 && (
            <Panel title="在建工程">
              <div className="p-3 space-y-2">
                {company.pending_orders.map((order, i) => {
                  const remainingQ = order.ready_quarter - (playerInfo?.global_quarter ?? 0)
                  return (
                    <div key={i} className="bg-bg-card rounded p-3 border border-border flex items-center gap-3">
                      <span className="text-xl">{isMfg ? '🏭' : '⛏️'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-text-primary">
                          {isMfg ? '新建产线' : '勘探矿脉'}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {isMfg ? `${order.amount} 条产线` : `${order.amount.toLocaleString()} 单位储量`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-accent-gold font-semibold">
                          {remainingQ > 0 ? `${remainingQ} 季度后${isMfg ? '投产' : '完工'}` : '本季度'}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          预计 {formatQuarter(order.ready_quarter)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          <Panel
            title={company.ipo_quarter > 0 ? '股票信息' : '股权结构'}
            headerAction={company.ipo_quarter > 0 ? (
              <span className="text-xs text-accent-green font-semibold">已上市</span>
            ) : undefined}
          >
            <div className="p-3">
              {company.ipo_quarter > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="总股本" value={`${company.total_shares.toLocaleString()}股`} />
                    <MetricCard label="股价" value={`¥${(company.stock_price / 100).toFixed(2)}`} />
                  </div>
                  <div className="mt-2">
                    <MetricCard label="市值" value={`¥${((company.stock_price * company.total_shares) / 100).toLocaleString()}`} className="text-center" />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="CEO持股" value={`${company.ceo_shares.toLocaleString()}股 (${(company.own_ratio * 100).toFixed(1)}%)`} />
                  <MetricCard label="投资方持股" value={`${company.investor_shares.toLocaleString()}股 (${((company.investor_shares / company.total_shares) * 100).toFixed(1)}%)`} />
                  <MetricCard label="总股本" value={`${company.total_shares.toLocaleString()}股`} />
                </div>
              )}
            </div>
          </Panel>

          {ipoStatus && !ipoStatus.conditions.listed && (
            <Panel title="IPO 进度">
              <div className="p-3">
                <ConditionBar label="运营季度" item={ipoStatus.conditions.quarters} suffix="季" />
                <ConditionBar label="连续盈利" item={ipoStatus.conditions.consecutive_profit} suffix="季" />
                <ConditionBar label="现金储备" item={ipoStatus.conditions.cash} suffix="¥" isCurrency />
                <ConditionBar label="近4季营收" item={ipoStatus.conditions.annual_revenue} suffix="¥" isCurrency />
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-xs text-text-muted mb-2">估值预览</div>
                  <div className="grid grid-cols-3 gap-2">
                    <MetricLabel label="NAV" value={`¥${ipoStatus.conditions.detail.nav.toFixed(2)}`} tooltip="(现金 + 固定资产) ÷ 总股本" />
                    <MetricLabel label="EPS" value={`¥${ipoStatus.conditions.detail.eps.toFixed(4)}`} tooltip="近4季平均净利润 ÷ 总股本" />
                    <MetricLabel label="PE" value={`${ipoStatus.conditions.detail.pe}×`} tooltip="行业基准市盈率" />
                  </div>
                  <button
                    className={`btn btn-full mt-2 ${ipoStatus.eligible ? 'btn-primary' : 'cursor-not-allowed bg-bg-card border border-border/50 text-text-muted'}`}
                    disabled={!ipoStatus.eligible}
                    onClick={() => setShowIpo(true)}
                  >
                    {ipoStatus.eligible ? '🚀 发起 IPO' : '条件未满足'}
                  </button>
                </div>
              </div>
            </Panel>
          )}

          <Panel
            title="财务表现"
            headerAction={
              confirmedQ ? (
                <button
                  onClick={() => setShowQuarterly(true)}
                  className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
                >
                  详情
                </button>
              ) : undefined
            }
          >
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="上季营收" value={`¥${company.revenue.toLocaleString()}`} />
                <MetricCard label="上季总支出" value={confirmedQ ? `¥${confirmedQ.total_cost.toLocaleString()}` : '—'} />
                <div className="col-span-2 bg-bg-card rounded p-4 border border-border text-center">
                  <div className="text-xs text-text-muted">上季利润</div>
                  <div className={`text-xl font-bold mt-1.5 ${company.profit >= 0 ? 'text-up' : 'text-down'}`}>
                    ¥{company.profit.toLocaleString()}
                  </div>
                </div>
              </div>
              <Link
                to="/game/company/quarterly"
                className="block w-full text-center text-xs text-accent-blue hover:text-accent-blue/80 transition-colors py-1.5 rounded border border-accent-blue/20 hover:border-accent-blue/40"
              >
                查看历史报表 →
              </Link>
            </div>
          </Panel>

          {showQuarterly && confirmedQ && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setShowQuarterly(false)}
            >
              <div
                className="bg-bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                  <h3 className="text-sm font-bold text-text-primary">
                    {formatQuarter(confirmedQ.quarter)} 财报详情
                  </h3>
                  <button
                    className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                    onClick={() => setShowQuarterly(false)}
                  >
                    ✕
                  </button>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto scrollbar-hide">
                  <section>
                    <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">财务摘要</div>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailItem label="营收" value={`¥${confirmedQ.revenue.toLocaleString()}`} />
                      <DetailItem label="利润" value={`¥${confirmedQ.profit.toLocaleString()}`} positive={confirmedQ.profit >= 0} />
                      <DetailItem label="支出" value={`¥${confirmedQ.total_cost.toLocaleString()}`} />
                      <DetailItem label="期末现金" value={`¥${confirmedQ.cash.toLocaleString()}`} />
                    </div>
                  </section>

                  <section>
                    <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">支出明细</div>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailItem label="人力支出" value={`¥${confirmedQ.labor_cost.toLocaleString()}`} hint={formatRatio(confirmedQ.labor_cost, confirmedQ.total_cost)} />
                      <DetailItem label="基础维护支出" value={`¥${confirmedQ.base_maintenance.toLocaleString()}`} hint={formatRatio(confirmedQ.base_maintenance, confirmedQ.total_cost)} />
                      <DetailItem label="运营支出" value={`¥${confirmedQ.operational_cost.toLocaleString()}`} hint={formatRatio(confirmedQ.operational_cost, confirmedQ.total_cost)} />
                      <DetailItem label="仓储支出" value={`¥${confirmedQ.warehouse_cost.toLocaleString()}`} hint={formatRatio(confirmedQ.warehouse_cost, confirmedQ.total_cost)} />
                    </div>
                  </section>

                  <section>
                    <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">运营指标</div>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailItem label="员工" value={`${confirmedQ.employees}人`} />
                      {company.industry === 'mining' ? null : (
                        <DetailItem label="产线" value={`${confirmedQ.cap_count}条`} />
                      )}
                      <DetailItem
                        label={company.industry === 'mining' ? '工人产能' : '有效产能'}
                        value={company.industry === 'mining'
                          ? `${(confirmedQ.employees * 1500).toLocaleString()}单位/季`
                          : `${Math.min(confirmedQ.employees * 2000, confirmedQ.cap_count * 10000).toLocaleString()}件/季`
                        }
                      />
                      {company.industry === 'mining' ? null : (
                        <DetailItem label="产能上限" value={`${(confirmedQ.cap_count * 10000).toLocaleString()}件/季`} />
                      )}
                      <DetailItem label="产量" value={`${confirmedQ.prod_qty.toLocaleString()}${company.industry === 'mining' ? '单位' : '件'}`} />
                      <DetailItem label="销量" value={`${confirmedQ.sales_qty.toLocaleString()}${company.industry === 'mining' ? '单位' : '件'}`} />
                      <DetailItem label="库存变更" value={`${confirmedQ.prod_qty - confirmedQ.sales_qty >= 0 ? '+' : ''}${(confirmedQ.prod_qty - confirmedQ.sales_qty).toLocaleString()}${company.industry === 'mining' ? '单位' : '件'}`} positive={confirmedQ.prod_qty - confirmedQ.sales_qty >= 0} />
                      <DetailItem label="库存" value={confirmedQ.inventory > 0 ? `${confirmedQ.inventory.toLocaleString()}${company.industry === 'mining' ? '单位' : '件'}` : '—'} />
                    </div>
                  </section>

                  <section>
                    <div className="text-xs font-semibold text-text-secondary mb-2 tracking-wider">股权数据</div>
                    <div className="grid grid-cols-2 gap-2">
                      <DetailItem label="CEO持股" value={`${confirmedQ.ceo_shares.toLocaleString()}股 (${(confirmedQ.ceo_shares / confirmedQ.total_shares * 100).toFixed(0)}%)`} />
                      <DetailItem label="投资方持股" value={`${confirmedQ.investor_shares.toLocaleString()}股`} />
                      <DetailItem label="总股本" value={`${confirmedQ.total_shares.toLocaleString()}股`} />
                      {confirmedQ.public_float > 0 && (
                        <DetailItem label="流通股" value={`${confirmedQ.public_float.toLocaleString()}股`} />
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}

          {showActions && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => { setShowActions(false); setActionView('selection') }}
            >
              <div
                className="bg-bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {actionView === 'selection' ? (
                  <>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="text-sm font-bold text-text-primary">
                        经营行动 · 剩余 {remaining}/3
                      </h3>
                      <button
                        className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                        onClick={() => { setShowActions(false) }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <button
                        className="w-full text-left p-4 rounded border border-border bg-bg-input hover:border-accent-blue hover:bg-accent-blue/5 transition-colors"
                        onClick={() => { setActionView('expand'); setActionAmount(0); setActionError('') }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">🏭</span>
                          <span className="text-sm font-semibold text-text-primary">{isMfg ? '新建产线' : '勘探矿脉'}</span>
                        </div>
                        <div className="text-xs text-text-muted">
                          ¥{expUnitCost.toLocaleString()}/{isMfg ? '条' : '次'} · {isMfg ? '1季后投产' : '2季后完工 · 储量随机'}
                        </div>
                      </button>

                      <button
                        className="w-full text-left p-4 rounded border border-border bg-bg-input hover:border-accent-blue hover:bg-accent-blue/5 transition-colors"
                        onClick={() => { setActionView('hire'); setActionAmount(0); setActionError('') }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">👥</span>
                          <span className="text-sm font-semibold text-text-primary">招募员工</span>
                        </div>
                        <div className="text-xs text-text-muted">
                          ¥{hireUnitCost.toLocaleString()}/岗 · 预计实招 30%~100%
                        </div>
                      </button>

                      <button
                        className="w-full text-left p-4 rounded border border-border bg-bg-input hover:border-accent-red hover:bg-accent-red/5 transition-colors"
                        onClick={() => { setActionView('layoff'); setActionAmount(0); setActionError('') }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">📉</span>
                          <span className="text-sm font-semibold text-text-primary">裁员</span>
                        </div>
                        <div className="text-xs text-text-muted">
                          ¥{layoffUnitCost.toLocaleString()}/人 · 补偿 3 倍季度工资
                        </div>
                      </button>

                      <button
                        className="w-full text-left p-4 rounded border border-border bg-bg-input hover:border-accent-blue hover:bg-accent-blue/5 transition-colors"
                        onClick={() => { setActionView('sell_assets'); setActionAmount(0); setActionError('') }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">🏷️</span>
                          <span className="text-sm font-semibold text-text-primary">资产处置</span>
                        </div>
                        <div className="text-xs text-text-muted">
                          {isMfg
                            ? `¥${Math.round(80000 * 0.75).toLocaleString()}/条 · 折价 75%`
                            : `¥${(2.0 * 0.75).toFixed(1)}/单位 · 折价 75%`}
                        </div>
                      </button>

                      <button
                        className="w-full text-left p-4 rounded border border-border bg-bg-input hover:border-accent-gold hover:bg-accent-gold/5 transition-colors"
                        onClick={() => { setActionView('marketing'); setActionAmount(0); setActionError('') }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">📢</span>
                          <span className="text-sm font-semibold text-text-primary">营销推广</span>
                        </div>
                        <div className="text-xs text-text-muted">
                          投入资金提升当季需求
                        </div>
                      </button>

                      {actionsSubmitted >= 3 && (
                        <p className="text-xs text-text-muted text-center">本季度操作次数已用完</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                      <button
                        className="text-text-muted hover:text-text-primary transition-colors text-sm"
                        onClick={() => { setActionView('selection'); setActionAmount(0); setActionError('') }}
                      >
                        ← 返回
                      </button>
                      <span className="text-sm font-semibold text-text-primary">
                        {actionConfig[actionView]?.title}
                      </span>
                    </div>

                    <div className="p-4 space-y-4">
                      <div>
                        <div className="flex justify-between text-xs text-text-secondary mb-1">
                          <span>
                            {actionConfig[actionView]?.inputLabel}
                          </span>
                          <span className="text-text-primary font-semibold">
                            {actionAmount.toLocaleString()}{' '}
                            {actionConfig[actionView]?.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={maxAmount}
                          step={1}
                          value={actionAmount}
                          onChange={(e) => setActionAmount(Number(e.target.value))}
                          className="w-full accent-accent-blue"
                        />
                        <div className="flex justify-between text-[11px] text-text-muted mt-0.5">
                          {actionView === 'expand' ? (
                            <>
                              <span>¥{expUnitCost.toLocaleString()}/{isMfg ? '条' : '次'}</span>
                              <span>{isMfg ? '1季后投产' : '2季后完工 · 储量随机（2万~16万单位）'}</span>
                            </>
                           ) : actionView === 'hire' ? (
                            <div className="flex flex-col gap-0.5 w-full">
                              <div className="flex justify-between">
                                <span>¥{hireUnitCost.toLocaleString()}/岗</span>
                                {actionAmount > 0 && (
                                  <span>预计实招 {Math.round(actionAmount * 0.3)}~{actionAmount} 人</span>
                                )}
                              </div>
                              {actionAmount > 0 && (() => {
                                const minRecruit = Math.round(actionAmount * 0.3)
                                const maxRecruit = actionAmount
                                const minNew = Math.min((company.employees + minRecruit) * perWorkerOutput, company.capacity_ceiling)
                                const maxNew = Math.min((company.employees + maxRecruit) * perWorkerOutput, company.capacity_ceiling)
                                return (
                                  <div className="flex justify-between">
                                    <span>预期产能</span>
                                    <span>{company.actual_output.toLocaleString()} → {minNew.toLocaleString()}~{maxNew.toLocaleString()} {outputUnit}/季</span>
                                  </div>
                                )
                              })()}
                            </div>
                           ) : actionView === 'layoff' ? (
                            <div className="flex flex-col gap-0.5 w-full">
                              <div className="flex justify-between">
                                <span>¥{layoffUnitCost.toLocaleString()}/人（3倍季度工资）</span>
                                {actionAmount > 0 && (
                                  <span>当前 {company.employees} 人 → {company.employees - actionAmount} 人</span>
                                )}
                              </div>
                              {actionAmount > 0 && (() => {
                                const newEmp = company.employees - actionAmount
                                const newOutput = Math.min(newEmp * perWorkerOutput, company.capacity_ceiling)
                                return (
                                  <div className="flex justify-between">
                                    <span>预期产能</span>
                                    <span>{company.actual_output.toLocaleString()} → {newOutput.toLocaleString()} {outputUnit}/季</span>
                                  </div>
                                )
                              })()}
                            </div>
                          ) : actionView === 'sell_assets' ? (
                            <span>{isMfg ? `¥${Math.round(80000 * 0.75).toLocaleString()}/条 · 当前 ${company.cap_count} 条` : `¥${(2.0 * 0.75).toFixed(1)}/单位 · 当前 ${company.cap_count.toLocaleString()} 单位`}</span>
                          ) : actionAmount > 0 ? (
                            <span>预计提升 {Math.round(actionAmount * marketingMinPerYuan).toLocaleString()}~{Math.round(actionAmount * marketingMaxPerYuan).toLocaleString()} {isMfg ? '件' : '单位'} 需求</span>
                          ) : (
                            <span>{isMfg ? '每¥1投入 = 0.075~0.175 件需求增量' : '每¥1投入 = 0.125~0.292 单位需求增量'}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-text-muted text-center">
                        {actionView === 'sell_assets' ? (
                          <>出售收入 <span className="font-semibold text-up">¥{income.toLocaleString()}</span></>
                        ) : (
                          <>成本 <span className={`font-semibold ${cost > company.cash ? 'text-down' : 'text-text-primary'}`}>¥{cost.toLocaleString()}</span></>
                        )}
                      </div>

                      {actionError && <p className="text-accent-red text-sm text-center">{actionError}</p>}

                      <button
                        className="btn btn-primary btn-full"
                        disabled={!canSubmit || submittingActions}
                        onClick={() => handleSubmitAction(actionView, actionAmount)}
                      >
                        {actionAmount === 0
                          ? '请选择数量'
                          : actionView === 'sell_assets' || actionView === 'layoff'
                          ? remaining <= 0
                            ? '操作次数已用完'
                            : submittingActions
                            ? '提交中...'
                            : actionView === 'sell_assets' ? '确认出售' : '确认裁员'
                          : cost > company.cash
                          ? '公司现金不足'
                          : remaining <= 0
                          ? '操作次数已用完'
                          : submittingActions
                          ? '提交中...'
                          : actionView === 'marketing'
                          ? '确认投入'
                          : '提交'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {showIpo && ipoStatus && ipoStatus.eligible && (() => {
            const detail = ipoStatus.conditions.detail
            const ipoPriceYuan = Math.max(1, (detail.nav + detail.eps * detail.pe) * 0.95)
            const floatShares = Math.round(company.total_shares * ipoFloatRatio)
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowIpo(false)}>
                <div className="bg-bg-card border border-border rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-text-primary mb-4">发起 IPO</h3>

                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-text-secondary mb-1">
                      <span>增发比例</span>
                      <span className="text-text-primary font-semibold">{(ipoFloatRatio * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.10}
                      max={0.50}
                      step={0.01}
                      value={ipoFloatRatio}
                      onChange={(e) => setIpoFloatRatio(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-[11px] text-text-muted mt-0.5">
                      <span>10%</span>
                      <span>50%</span>
                    </div>
                  </div>

                  <div className="bg-bg-card rounded-lg p-3 mb-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-muted">总股本(IPO前)</span>
                      <span className="text-text-primary">{company.total_shares.toLocaleString()} 股</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">增发股数</span>
                      <span className="text-accent-blue font-semibold">{floatShares.toLocaleString()} 股</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">IPO后总股本</span>
                      <span className="text-text-primary">{(company.total_shares + floatShares).toLocaleString()} 股</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between">
                      <span className="text-text-muted">每股净资产(NAV)</span>
                      <span className="text-text-primary">¥{detail.nav.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">每股收益(EPS)</span>
                      <span className="text-text-primary">¥{detail.eps.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">行业PE</span>
                      <span className="text-text-primary">{detail.pe}×</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between">
                      <span className="text-text-muted">发行价 (95%折)</span>
                      <span className="text-accent-gold font-bold text-base">¥{ipoPriceYuan.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">募集资金</span>
                      <span className="text-accent-green font-semibold">¥{Math.round(floatShares * ipoPriceYuan).toLocaleString()}</span>
                    </div>
                  </div>

                  {ipoError && <p className="text-accent-red text-sm mb-3 text-center">{ipoError}</p>}

                  <div className="flex gap-3">
                    <button className="btn btn-full flex-1" onClick={() => setShowIpo(false)}>取消</button>
                    <button
                      className="btn btn-primary btn-full flex-1"
                      disabled={submittingIpo}
                      onClick={handleIpo}
                    >
                      {submittingIpo ? '提交中...' : '确认上市'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
          )})()}
      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="bg-bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-bold text-text-primary">📖 公司经营玩法说明</h3>
              <button
                className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                onClick={() => setShowGuide(false)}
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto scrollbar-hide space-y-6 text-xs text-text-secondary leading-relaxed">

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">一</span> 公司经营概览
                </h4>
                <p>
                  大猫投资有两套并行玩法：<span className="text-accent-blue font-semibold">股票交易</span>（低买高卖赚差价）和
                  <span className="text-accent-blue font-semibold">公司经营</span>（当CEO运营一家公司）。两者相互联动——你经营的公司IPO后可上市交易，
                  股价由公司基本面驱动，最终影响你的个人资产排名。
                </p>
                <p className="mt-2">
                  游戏时间以<span className="text-accent-gold font-semibold">季度</span>为节奏：<span className="text-accent-green">1季度 = 5分钟</span>。
                  每季度你有 <span className="text-accent-green font-semibold">3次经营行动</span>机会，通过扩产、招人、营销等操作提升公司盈利，
                  最终目标是达成IPO条件上市，让市场为你的经营成果买单。
                </p>
                <div className="bg-bg-input rounded p-3 border border-border mt-3">
                  <div className="text-xs font-semibold text-text-primary mb-1.5">公司生命周期</div>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className="bg-accent-blue/10 text-accent-blue px-1.5 py-0.5 rounded">创建公司</span>
                    <span className="text-text-muted">→</span>
                    <span className="bg-accent-blue/10 text-accent-blue px-1.5 py-0.5 rounded">季度经营</span>
                    <span className="text-text-muted">→</span>
                    <span className="bg-accent-green/10 text-accent-green px-1.5 py-0.5 rounded">达成IPO条件</span>
                    <span className="text-text-muted">→</span>
                    <span className="bg-accent-gold/10 text-accent-gold px-1.5 py-0.5 rounded">上市交易</span>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">二</span> 创建公司
                </h4>
                <p>创建公司时需要决定三个关键参数：</p>
                <div className="mt-2 space-y-2">
                  <div className="flex gap-3">
                    <span className="text-accent-blue font-semibold shrink-0 text-[11px] mt-0.5">① 行业</span>
                    <span>
                      当前开放<span className="text-accent-green">制造业</span>（🏭 产能为王，规模效应）和
                      <span className="text-accent-green">矿业</span>（⛏️ 资源消耗型，储量递减）。
                      各行业产能模型完全不同，详见第三节。
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent-blue font-semibold shrink-0 text-[11px] mt-0.5">② 投资方持股</span>
                    <span>
                      投资方持股 = 外来的钱。你固定持有<span className="text-accent-gold">10万股 CEO股份</span>，
                      投资方持股越多（10万~190万股），公司现金越多，但你个人占股越低。
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent-blue font-semibold shrink-0 text-[11px] mt-0.5">③ 个人出资</span>
                    <span>
                      你从个人腰包投入公司的金额。公司初始现金 =
                      <span className="text-accent-gold font-mono">个人出资 ÷ 你的持股比例</span>，
                      这就是<span className="text-accent-green">杠杆效应</span>——你出1份钱撬动N份。
                    </span>
                  </div>
                </div>

                <div className="bg-bg-input rounded p-3 border border-border mt-3">
                  <div className="text-xs font-semibold text-text-primary mb-1.5">出资示例（投资方持股=50万）</div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-text-muted">你出资</div>
                      <div className="text-accent-blue font-semibold">¥50,000</div>
                    </div>
                    <div>
                      <div className="text-text-muted">你的占股</div>
                      <div className="text-accent-green font-semibold">16.7%</div>
                    </div>
                    <div>
                      <div className="text-text-muted">公司现金</div>
                      <div className="text-accent-gold font-semibold">¥300,000</div>
                    </div>
                  </div>
                  <p className="mt-1.5 text-text-muted">你出5万，公司有30万。剩余的25万是投资方出的。</p>
                </div>

                <div className="bg-accent-blue/5 border border-accent-blue/20 rounded p-3 mt-3">
                  <div className="text-xs font-semibold text-text-primary mb-1">💡 策略提示</div>
                  <p>
                    高占比策略（投资方少）= 自己吃肉多，但公司穷，早期扩产慢。<br />
                    低占比策略（投资方多）= 公司富，但你的股权被稀释，上市后赚得少。<br />
                    如果你计划快速做大→IPO→市场接盘，低占比也是合理策略。
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">三</span> 行业差异（制造 vs 矿业）
                </h4>
                <div className="bg-bg-card rounded border border-border overflow-hidden text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-bg-input">
                        <th className="text-left p-2 text-text-secondary font-medium w-20">对比维度</th>
                        <th className="text-left p-2 text-text-secondary font-medium">🏭 制造业</th>
                        <th className="text-left p-2 text-text-secondary font-medium">⛏️ 矿业</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50">
                        <td className="p-2 text-text-muted">天花板</td>
                        <td className="p-2">产线（¥80,000/条，1季建成）</td>
                        <td className="p-2">探明储量（起始50,000单位）</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="p-2 text-text-muted">单位产出</td>
                        <td className="p-2">2,000件/人·季</td>
                        <td className="p-2">1,500单位/人·季</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="p-2 text-text-muted">产能上限</td>
                        <td className="p-2">产线数 × 10,000件/季</td>
                        <td className="p-2">储量 × 20%（递减！）</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="p-2 text-text-muted">售价弹性</td>
                        <td className="p-2">景气度^0.6 温和波动</td>
                        <td className="p-2">景气度^1.2 价格剧烈波动</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="p-2 text-text-muted">核心博弈</td>
                        <td className="p-2">配平工人+产线+需求</td>
                        <td className="p-2">储量递减，勘探续命</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-text-muted">行业PE</td>
                        <td className="p-2 text-accent-gold font-semibold">12倍</td>
                        <td className="p-2 text-accent-gold font-semibold">10倍</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 space-y-2">
                  <p>
                    <span className="text-accent-blue font-semibold">制造业核心：</span>
                    产线有维护费（¥1,000~3,000/条/季），闲置产线就是纯烧钱。库存有仓储费（¥0.5/件/季），产能过剩→库存积压→仓储费吃利润。需要精准配平工人与产线。
                  </p>
                  <p>
                    <span className="text-accent-blue font-semibold">矿业核心：</span>
                    每季度储量 -20%（开采），不可再生。3~4个季度后产量自然腰斩。必须定期勘探（¥120,000/次，2季见效）补充储量。矿价弹性大，可屯矿等景气高位抛售。
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">四</span> 季度经营系统
                </h4>
                <p>每5分钟触发一次季度结算，流程如下：</p>
                <div className="bg-bg-input rounded p-3 border border-border mt-2">
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2">
                      <span className="text-accent-blue shrink-0">① 景气度更新</span>
                      <span className="text-text-muted">每个行业的景气度（0.70~1.30）做随机漫步，影响需求和售价</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-accent-blue shrink-0">② 自动结算</span>
                      <span className="text-text-muted">系统按当前状态生成baseline快照（营收/成本/利润等）</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-accent-green shrink-0">③ CEO决策</span>
                      <span className="text-text-muted">5分钟窗口内提交经营行动，决策后在baseline基础上重新计算</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-text-muted shrink-0">④ 季度公告</span>
                      <span className="text-text-muted">向市场公布财报，上市公司股价相应波动</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2">
                  景气度是行业需求的晴雨表。制造景气度 0.80~1.20（温和），矿业 0.72~1.28（剧烈）。
                  景气度越高→需求越旺→售价越高。极端景气度会向中心回归，不会永久高/低。
                </p>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">五</span> 五大经营行动详解
                </h4>
                <p className="mb-3">
                  每季度最多提交 <span className="text-accent-green font-semibold">3次行动</span>，可自由组合。
                </p>
                <div className="space-y-3">
                  <div className="bg-bg-card rounded border border-border p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">🏭</span>
                      <span className="text-sm font-semibold text-text-primary">扩产（建造产能单元）</span>
                    </div>
                    <p>成本：制造 ¥80,000/条产线，矿业 ¥120,000/次勘探。进入建造队列，制造1季后投产，矿业2季后增加储量。多个扩产可排队建造。</p>
                    <p className="text-text-muted mt-1">⚠️ 扩产前先检查需求余量，别在需求萎缩时扩。每条产线有维护费。</p>
                  </div>

                  <div className="bg-bg-card rounded border border-border p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">👥</span>
                      <span className="text-sm font-semibold text-text-primary">招人</span>
                    </div>
                    <p>成本：¥3,000 × 发布岗位数。实际招到人数 = 发布数 ×（30%~100%），有随机性。员工越多产能越高，但也增加薪资支出（¥2,500/人/季）。</p>
                    <p className="text-text-muted mt-1">⚠️ 招人后要检查产线/储量是否足够支撑，否则多余工人不出活白拿工资。</p>
                  </div>

                  <div className="bg-bg-card rounded border border-border p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">✂️</span>
                      <span className="text-sm font-semibold text-text-primary">裁员</span>
                    </div>
                    <p>成本：¥7,500 × 裁退人数（3倍季度工资补偿）。可裁至0人。虽然补偿贵，但停掉 ¥2,500/季工资+运营成本，约2季度回本。</p>
                  </div>

                  <div className="bg-bg-card rounded border border-border p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">💰</span>
                      <span className="text-sm font-semibold text-text-primary">卖资产（折价换现金）</span>
                    </div>
                    <p>折价75%出售：制造产线 ¥60,000/条，矿业储量 ¥1.5/单位。适合急需现金周转时使用。卖出后CapCount减少，产能永久降低。</p>
                  </div>

                  <div className="bg-bg-card rounded border border-accent-gold/30 bg-accent-gold/5 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">📢</span>
                      <span className="text-sm font-semibold text-text-primary">营销（核心行动）</span>
                    </div>
                    <p>投入 ¥N → 当季需求 +round(N × 随机倍率)。制造 0.075~0.175/¥，矿业 0.125~0.292/¥。</p>
                    <p className="mt-1">例：投入 ¥20,000 → 制造需求+1,500~3,500，矿业需求+2,500~5,833。</p>
                    <p className="text-accent-gold mt-1">💡 营销是唯一可以直接拉升需求的手段。需求=营收上限，先营销拉需求→再扩产扩产能→利润爆发。</p>
                    <p className="text-text-muted mt-1">注意：效果当季生效不跨季，且受产能封顶限制（需求不能超过产能×2+库存）。</p>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">六</span> 财务与成本结构
                </h4>

                <div className="bg-bg-input rounded p-3 border border-border mb-3">
                  <div className="text-xs font-semibold text-text-primary mb-2">制造成本链</div>
                  <pre className="text-[11px] text-text-muted leading-relaxed font-mono whitespace-pre-wrap">
{`营收    = 销量 × 售价（¥20 × 景气度^0.6）
生产量  = MIN(工人×2,000, 产线×10,000)
销量    = MIN(产量+库存, 需求)
库存    = MAX(0, 上季库存 + 产量 - 销量)

总成本  = 人工（¥2,500/人）
        + 基础维护（¥1,000/条 × 全部产线）
        + 运营成本（¥2,000/条 × 开工产线）
        + 仓储费（¥0.5/件 × 库存）

净利润  = 营收 - 总成本`}
                  </pre>
                </div>

                <div className="bg-bg-input rounded p-3 border border-border">
                  <div className="text-xs font-semibold text-text-primary mb-2">矿业成本链</div>
                  <pre className="text-[11px] text-text-muted leading-relaxed font-mono whitespace-pre-wrap">
{`营收    = 销量 × 售价（¥12 × 景气度^1.2）
季度上限 = 储量 × 20%
生产量  = MIN(工人×1,500, 季度上限)
储量    = 上季储量 - 生产量  ← 不可逆递减！

总成本  = 人工（¥2,500/人）
        + 基础维护（储量÷100 + ¥1）
        + 运营成本（¥1,200/人 × 开工工人）
        + 仓储费（¥0.3/单位 × 库存）

净利润  = 营收 - 总成本`}
                  </pre>
                </div>

                <p className="mt-3">
                  <span className="text-accent-blue font-semibold">仓库费是隐形成本杀手：</span>
                  库存没卖出去不仅要占用资金，还要交仓储费。制造每件¥0.5/季，矿业每单位¥0.3/季。
                  库存越多仓储费越高，会持续侵蚀利润。但适当库存可缓冲需求波动。
                </p>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">七</span> IPO上市全流程
                </h4>

                <div className="bg-bg-input rounded p-3 border border-border mb-3">
                  <div className="text-xs font-semibold text-text-primary mb-2">四大必要条件</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-accent-blue shrink-0" />
                      <span>运营 ≥ <span className="text-accent-blue font-semibold">12季度</span>（60分钟）</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-accent-green shrink-0" />
                      <span>连续盈利 ≥ <span className="text-accent-green font-semibold">4季度</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-accent-gold shrink-0" />
                      <span>现金 ≥ <span className="text-accent-gold font-semibold">¥100万</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-accent-red shrink-0" />
                      <span>近4季营收合计 ≥ <span className="text-accent-red font-semibold">¥500万</span></span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p>满足条件后，发起IPO时选择<span className="text-accent-blue">增发比例</span>（滑块自选），决定多少股份放入市场流通。</p>
                  <p><span className="text-accent-gold font-semibold">发行价 = 理论股价 × 0.95</span>（IPO承销折扣）。</p>
                  <p>公司股价从此由<span className="text-accent-green">市场撮合引擎</span>决定——买卖供需决定价格，不再等于理论估值。</p>
                </div>

                <div className="bg-accent-red/5 border border-accent-red/20 rounded p-3 mt-3">
                  <div className="text-xs font-semibold text-text-primary mb-1">⚠️ 关键提醒</div>
                  <p>一旦亏损断掉，"连续盈利4季"条件<span className="text-accent-red font-semibold">重置归零</span>，这是最大的隐性成本。别为了博一次高利润冒险做激进操作。</p>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">八</span> 股价与估值
                </h4>

                <div className="bg-bg-input rounded p-3 border border-border mb-3">
                  <pre className="text-[11px] text-text-muted leading-relaxed font-mono whitespace-pre-wrap">
{`理论股价 = max(1, NAV + EPS × 行业PE × 景气度)

NAV（净资产）= (现金 + CapCount×资产单价) / 总股本
EPS（每股收益）= 近4季平均净利润 / 总股本
行业PE：制造12 | 矿业10 | 科技25 | 金融12 | 消费20 | 医疗30`}
                  </pre>
                </div>

                <div className="space-y-2">
                  <p>
                    <span className="text-accent-blue font-semibold">NAV是清算地板价</span>——即使公司不赚钱，它的资产也有价值。
                    NAV高意味着公司硬资产多（现金多或固定资产多）。
                  </p>
                  <p>
                    <span className="text-accent-green font-semibold">EPS×PE是成长溢价</span>——持续盈利的公司享有PE倍数的估值加成。
                    盈利越好、行业PE越高，股价越值钱。
                  </p>
                  <p>
                    <span className="text-accent-gold font-semibold">PE动态调整：</span>
                    营收增速 &gt; 20% → PE临时+20%；
                    营收增速 &lt; -10% → PE临时-15%；
                    连续亏损 → PE临时-20%。
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">九</span> 经营策略与技巧
                </h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">营销—扩产联动：</span>
                      <span>先营销拉需求→需求接近产能上限→再扩产。避免扩了产线没需求的尴尬。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">人力配平：</span>
                      <span>工人×人均产出 ≈ 产线×产线产能。人多了白拿工资，产线多了白交维护费。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">现金管理：</span>
                      <span>公司现金有利息（0.5%/季），但现金太少无法操作。保持至少2-3次扩产+营销的余量。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">矿业必做：</span>
                      <span>预留¥120,000勘探资金。储量衰减后产量自然下降，别等到工人闲置才想起勘探。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">IPO时机：</span>
                      <span>别急着上市，等公司规模做大再IPO。规模越大→发行价越高→你的CEO股份越值钱。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-green shrink-0 mt-0.5">✓</span>
                    <div>
                      <span className="text-text-primary font-semibold">利润vs规模：</span>
                      <span>扩产/招人是投入期（短期利润下降），产能需求匹配后利润爆发。忍受投入期的阵痛。</span>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-bold text-text-primary border-b border-border pb-1.5 mb-3">
                  <span className="text-accent-blue">十</span> 常见误区
                </h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"扩产越多越好"</span>
                      <span className="text-text-muted"> — 每条产线有维护费，闲置产线就是纯烧钱。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"招很多人"</span>
                      <span className="text-text-muted"> — 工人多了但产线/储量不够，多余工人没有产出，工资照付。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"先IPO再说"</span>
                      <span className="text-text-muted"> — 小公司低价上市，发行价低，你的CEO股份卖不出好价钱。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"矿业不用扩产"</span>
                      <span className="text-text-muted"> — 储量会耗尽！不勘探3-4个季度后产量腰斩。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"营销没用"</span>
                      <span className="text-text-muted"> — 营销是唯一可直接拉升需求的手段，需求=营收上限。</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-accent-red shrink-0 mt-0.5">✗</span>
                    <div>
                      <span className="text-text-primary font-semibold">"裁员不划算"</span>
                      <span className="text-text-muted"> — 虽花¥7,500补偿但停掉¥2,500/季工资+运营成本，约2季度回本。</span>
                    </div>
                  </div>
                </div>
              </section>

              <div className="pt-3 border-t border-border text-center">
                <p className="text-text-muted">每季度都是新的开始，祝你的公司早日上市！🚀</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, hint, className, colorClass }: { label: string; value: string; hint?: string; className?: string; colorClass?: string }) {
  return (
    <div className={`bg-bg-card rounded p-2.5 border border-border relative group ${className ?? ''}`}>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${colorClass ?? 'text-text-primary'}`}>{value}</div>
      {hint && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-bg-input border border-border rounded text-[11px] text-text-secondary whitespace-pre-line leading-relaxed opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 pointer-events-none max-w-[280px] shadow-lg">
          {hint}
        </div>
      )}
    </div>
  )
}

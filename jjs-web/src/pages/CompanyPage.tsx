import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/api/client'
import { useCompanyState, usePlayerInfo } from '@/api/queries'
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

const CEO_SHARES = 10000
const TOTAL_SHARES_MIN = 10000
const TOTAL_SHARES_MAX = 200000
const INVEST_MIN = 1000

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
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [companyName, setCompanyName] = useState('')
  const [totalShares, setTotalShares] = useState(50000)
  const [playerInvestment, setPlayerInvestment] = useState(50000)
  const [creating, setCreating] = useState(false)
  const [showQuarterly, setShowQuarterly] = useState(false)
  const [error, setError] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [actionView, setActionView] = useState<'selection' | 'expand' | 'hire'>('selection')
  const [actionAmount, setActionAmount] = useState(0)
  const [actionsSubmitted, setActionsSubmitted] = useState(0)
  const [submittingActions, setSubmittingActions] = useState(false)
  const [actionError, setActionError] = useState('')
  const queryClient = useQueryClient()

  const playerCash = playerInfo?.cash ?? 100000

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
        total_shares: totalShares,
        player_investment: playerInvestment,
      })
      queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleSubmitAction = async (type: 'expand' | 'hire', amount: number) => {
    if (!company) return
    setSubmittingActions(true)
    setActionError('')
    try {
      await api.post<ActionResponse>('/company/actions', { actions: [{ type, amount }] })
      setActionsSubmitted(prev => prev + 1)
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
                    <span>发行总股本</span>
                    <span className="text-text-primary font-semibold">{totalShares.toLocaleString()} 股</span>
                  </div>
                  <input
                    type="range"
                    min={TOTAL_SHARES_MIN}
                    max={TOTAL_SHARES_MAX}
                    step={1000}
                    value={totalShares}
                    onChange={(e) => setTotalShares(Number(e.target.value))}
                    className="w-full accent-accent-blue"
                  />
                  <div className="flex justify-between text-[11px] text-text-muted mt-0.5">
                    <span>1万</span>
                    <span>20万</span>
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
          const maxAmount = Math.floor(company.cash / (actionView === 'expand' ? expUnitCost : hireUnitCost))
          const cost = actionAmount * (actionView === 'expand' ? expUnitCost : hireUnitCost)
          const remaining = 3 - actionsSubmitted
          const canSubmit = actionAmount > 0 && cost <= company.cash && remaining > 0

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
                {company.pending_builds > 0 ? (
                  <div className="bg-bg-card rounded p-2.5 border border-border flex items-center">
                    <span className="text-xs text-accent-gold">
                      ⏳ {company.pending_builds} 个{company.industry === 'mining' ? '勘探' : '产线建造'}中
                    </span>
                  </div>
                ) : <div />}
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => { setShowActions(true); setActionView('selection'); setActionAmount(0); setActionError('') }}
                >
                  ⚡ 经营行动{actionsSubmitted > 0 ? ` (${actionsSubmitted}/3)` : ''}
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="股权结构">
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="总股本" value={`${company.total_shares.toLocaleString()}股`} />
                <MetricCard label="CEO持股" value={`${company.ceo_shares.toLocaleString()}股 (${(company.own_ratio * 100).toFixed(1)}%)`} />
              </div>
            </div>
          </Panel>

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
                      <DetailItem label="总股本" value={`${confirmedQ.total_shares.toLocaleString()}股`} />
                      <DetailItem label="CEO持股" value={`${confirmedQ.ceo_shares.toLocaleString()}股 (${(confirmedQ.ceo_shares / confirmedQ.total_shares * 100).toFixed(0)}%)`} />
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}

          {showActions && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => { setShowActions(false); setActionView('selection'); setActionsSubmitted(0) }}
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
                        onClick={() => { setShowActions(false); setActionsSubmitted(0) }}
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
                          ¥{hireUnitCost.toLocaleString()}/人 · 预计实招 60%~140%
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
                        {actionView === 'expand' ? (isMfg ? '新建产线' : '勘探矿脉') : '招募员工'}
                      </span>
                    </div>

                    <div className="p-4 space-y-4">
                      <div>
                        <div className="flex justify-between text-xs text-text-secondary mb-1">
                          <span>{actionView === 'expand' ? (isMfg ? '新建产线数量' : '勘探次数') : '招募人数'}</span>
                          <span className="text-text-primary font-semibold">
                            {actionAmount.toLocaleString()} {actionView === 'expand' ? (isMfg ? '条' : '次') : '人'}
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
                          <span>¥{(actionView === 'expand' ? expUnitCost : hireUnitCost).toLocaleString()}/{actionView === 'expand' ? (isMfg ? '条' : '次') : '人'}</span>
                          {actionView === 'expand' ? (
                            <span>{isMfg ? '1季后投产' : '2季后完工 · 储量随机（2万~16万单位）'}</span>
                          ) : (
                            actionAmount > 0 && (
                              <span>预计实招 {Math.round(actionAmount * 0.6)}~{Math.round(actionAmount * 1.4)} 人</span>
                            )
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-text-muted text-center">
                        成本 <span className={`font-semibold ${cost > company.cash ? 'text-down' : 'text-text-primary'}`}>¥{cost.toLocaleString()}</span>
                      </div>

                      {actionError && <p className="text-accent-red text-sm text-center">{actionError}</p>}

                      <button
                        className="btn btn-primary btn-full"
                        disabled={!canSubmit || submittingActions}
                        onClick={() => handleSubmitAction(actionView, actionAmount)}
                      >
                        {actionAmount === 0
                          ? '请选择数量'
                          : cost > company.cash
                          ? '公司现金不足'
                          : remaining <= 0
                          ? '操作次数已用完'
                          : submittingActions
                          ? '提交中...'
                          : '提交'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {company.pending_builds > 0 && (
            <div className="mt-2 text-xs text-accent-gold">
              ⏳ {company.pending_builds} 个{company.industry === 'mining' ? '勘探' : '产能'}正在建造中
            </div>
          )}
        </div>
          )})()}
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

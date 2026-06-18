import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useCompanyState, usePlayerInfo } from '@/api/queries'
import { Panel } from '@/components/Panel'

const INDUSTRY_META: Record<string, { name: string; icon: string; desc: string; enabled: boolean }> = {
  tech:          { name: '科技',     icon: '💻', desc: '技术驱动，重研发投入，设备迭代快', enabled: false },
  finance:       { name: '金融',     icon: '🏦', desc: '资本运作，高杠杆高回报，牌照壁垒高', enabled: false },
  manufacturing: { name: '制造',     icon: '🏭', desc: '产能为王，规模效应，注意库存积压', enabled: false },
  energy:        { name: '能源',     icon: '🛢️', desc: '资源开采，矿藏会枯竭，需持续勘探', enabled: false },
  consumer:      { name: '消费',     icon: '🛍️', desc: '品牌驱动，营销为王，热度就是生命', enabled: false },
  healthcare:    { name: '医疗',     icon: '💊', desc: '研发周期长，专利护城河，慢热暴利', enabled: false },
}

const CEO_SHARES = 10000
const TOTAL_SHARES_MIN = 10000
const TOTAL_SHARES_MAX = 200000
const INVEST_MIN = 1000

export function CompanyPage() {
  const { data: company, isLoading } = useCompanyState()
  const { data: playerInfo } = usePlayerInfo()
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [companyName, setCompanyName] = useState('')
  const [totalShares, setTotalShares] = useState(50000)
  const [playerInvestment, setPlayerInvestment] = useState(50000)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const playerCash = playerInfo?.cash ?? 100000

  const ownRatio = useMemo(() => CEO_SHARES / totalShares, [totalShares])
  const companyCash = useMemo(() => playerInvestment / ownRatio, [playerInvestment, ownRatio])
  const socialShares = useMemo(() => totalShares - CEO_SHARES, [totalShares])

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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-muted">加载中...</p>
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="bg-bg-card rounded p-2 border border-border">
                  <div className="text-[11px] text-text-muted">您的持股</div>
                  <div className="text-sm font-semibold text-accent-blue">{CEO_SHARES.toLocaleString()} 股</div>
                </div>
                <div className="bg-bg-card rounded p-2 border border-border">
                  <div className="text-[11px] text-text-muted">社会股本</div>
                  <div className="text-sm font-semibold text-text-primary">{socialShares.toLocaleString()} 股</div>
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
      ) : (
        <div className="space-y-3">
          <Panel title="公司概览">
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{INDUSTRY_META[company.industry]?.icon}</span>
                <div>
                  <div className="text-lg font-bold text-text-primary">{company.name}</div>
                  <div className="text-xs text-text-muted">
                    {company.symbol} · {INDUSTRY_META[company.industry]?.name} · Q{company.quarter}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <MetricCard label="现金" value={`¥${company.cash.toLocaleString()}`} />
                <MetricCard label="员工" value={`${company.employees}人`} />
                <MetricCard label="股本" value={`${company.total_shares.toLocaleString()}股`} />
                <MetricCard label="产能" value={`${company.cap_count}组`} />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <MetricCard
                  label="CEO持股"
                  value={`${company.ceo_shares.toLocaleString()}股 (${(company.own_ratio * 100).toFixed(1)}%)`}
                />
                <MetricCard label="社会股本" value={`${company.social_shares.toLocaleString()}股`} />
                <MetricCard label="上季营收" value={`¥${company.revenue.toLocaleString()}`} />
                <MetricCard label="上季利润" value={`¥${company.profit.toLocaleString()}`} />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <MetricCard label="库存" value={company.inventory > 0 ? `${company.inventory}` : '—'} />
                <MetricCard label="淤积等级" value={company.sludge_level > 0 ? `${company.sludge_level}级` : '—'} />
              </div>

              {company.pending_builds > 0 && (
                <div className="text-xs text-accent-gold">
                  ⏳ {company.pending_builds} 个产能正在建造中
                </div>
              )}
            </div>
          </Panel>

          {company.quarterly && company.quarterly.length > 1 && (
            <Panel title="季度报表">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border">
                      <th className="p-2 text-left">季度</th>
                      <th className="p-2 text-right">营收</th>
                      <th className="p-2 text-right">利润</th>
                      <th className="p-2 text-right">现金</th>
                      <th className="p-2 text-right">员工</th>
                      <th className="p-2 text-right">产能</th>
                    </tr>
                  </thead>
                  <tbody>
                    {company.quarterly.filter(q => q.quarter > 0).slice(-8).map((q) => (
                      <tr key={q.ID} className="border-b border-border/50 hover:bg-bg-hover">
                        <td className="p-2 text-text-secondary">Q{q.quarter}</td>
                        <td className="p-2 text-right text-text-primary">¥{q.revenue.toLocaleString()}</td>
                        <td className={`p-2 text-right ${q.profit >= 0 ? 'text-up' : 'text-down'}`}>
                          ¥{q.profit.toLocaleString()}
                        </td>
                        <td className="p-2 text-right text-text-primary">¥{q.cash.toLocaleString()}</td>
                        <td className="p-2 text-right text-text-primary">{q.employees}人</td>
                        <td className="p-2 text-right text-text-primary">{q.cap_count}组</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card rounded p-2.5 border border-border">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text-primary mt-0.5">{value}</div>
    </div>
  )
}

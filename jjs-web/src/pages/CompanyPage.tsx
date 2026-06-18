import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useCompanyState } from '@/api/queries'
import { Panel } from '@/components/Panel'

const INDUSTRY_META: Record<string, { name: string; icon: string; desc: string }> = {
  tech:          { name: '科技',     icon: '💻', desc: '高PE，重研发，服务器每5季贬值30%' },
  finance:       { name: '金融',     icon: '🏦', desc: '高杠杆，牌照贵但收益上限高' },
  manufacturing: { name: '制造',     icon: '🏭', desc: '劳动密集，利润率稳定，注意库存' },
  energy:        { name: '能源',     icon: '🛢️', desc: '矿会枯竭，趁早挖，存钱找新矿' },
  consumer:      { name: '消费',     icon: '🛍️', desc: '持续营销保持热度，品牌冷却即客流断' },
  healthcare:    { name: '医疗',     icon: '💊', desc: '慢热暴利，专利收租，管线积压头疼' },
}

export function CompanyPage() {
  const { data: company, isLoading } = useCompanyState()
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [companyName, setCompanyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const handleCreate = async () => {
    if (!selectedIndustry || !companyName.trim()) return
    setCreating(true)
    setError('')
    try {
      await api.post('/company/create', {
        name: companyName.trim(),
        industry: selectedIndustry,
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
        <h2 className="text-base font-bold text-text-primary">公司经营</h2>
      </div>

      {!hasCompany ? (
        <div className="space-y-4">
          <Panel title="选择行业">
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(INDUSTRY_META).map(([key, meta]) => (
                  <button
                    key={key}
                    className={`text-left p-3 rounded border transition-colors ${
                      selectedIndustry === key
                        ? 'border-accent-blue bg-accent-blue/10'
                        : 'border-border bg-bg-card hover:border-border-light'
                    }`}
                    onClick={() => setSelectedIndustry(key)}
                  >
                    <div className="text-lg mb-1">{meta.icon}</div>
                    <div className="text-sm font-semibold text-text-primary">{meta.name}</div>
                    <div className="text-[11px] text-text-muted mt-1">{meta.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="公司名称">
            <div className="p-3">
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="给你的公司起个名字"
                maxLength={20}
              />
              {error && <p className="text-accent-red text-sm mt-2">{error}</p>}
              <button
                className="btn btn-primary btn-full mt-3"
                disabled={!selectedIndustry || !companyName.trim() || creating}
                onClick={handleCreate}
              >
                {creating ? '创建中...' : '创建公司'}
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
                <MetricCard label="上季营收" value={`¥${company.revenue.toLocaleString()}`} />
                <MetricCard label="上季利润" value={`¥${company.profit.toLocaleString()}`} />
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

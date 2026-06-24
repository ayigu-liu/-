import { Link } from '@tanstack/react-router'

interface DockItem {
  to: string
  icon: string
  label: string
}

const items: DockItem[] = [
  { to: '/game/market', icon: '📈', label: '市场' },
  { to: '/game/portfolio', icon: '📊', label: '持仓' },
  { to: '/game/company', icon: '🏢', label: '公司' },
  { to: '/game/leaderboard', icon: '🏆', label: '排行' },
]

export function Dock() {
  return (
    <nav className="flex items-stretch border-t border-border bg-bg-card">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-text-muted transition-colors hover:text-text-primary hover:bg-white/[0.03] [&.active]:text-accent-blue [&.active]:border-t-2 [&.active]:border-accent-blue [&.active]:pt-[6px]"
          activeOptions={{ exact: true }}
        >
          <span className="text-lg leading-none">{item.icon}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  )
}

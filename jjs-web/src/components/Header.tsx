import { useAuthStore } from '@/stores/authStore'
import { useGameStore } from '@/stores/gameStore'

interface HeaderProps {
  cash?: number | null
  nickname?: string | null
}

export function Header({ cash, nickname: playerNickname }: HeaderProps) {
  const authNickname = useAuthStore((s) => s.nickname)
  const nickname = playerNickname || authNickname
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const wsConnected = useGameStore((s) => s.wsConnected)
  const wsLatency = useGameStore((s) => s.wsLatency)
  const tickCountdown = useGameStore((s) => s.tickCountdown)
  const playerCount = useGameStore((s) => s.playerCount)
  const togglePanel = useGameStore((s) => s.togglePanel)

  return (
    <header className="flex items-center justify-between px-5 py-2.5 bg-gradient-header border-b border-border shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold tracking-wider text-accent-gold">大猫投资</span>
        <span className="text-xs px-2.5 py-0.5 rounded-xl bg-bg-input text-text-secondary">
          入市请谨慎 · 投资有风险
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xl font-bold tracking-wide tabular-nums text-accent-gold">
          {cash != null ? `¥${cash.toLocaleString()}` : '¥--'}
        </span>
        {tickCountdown > 0 && (
          <span
            className={`text-sm font-semibold tabular-nums min-w-[40px] ${
              tickCountdown <= 5 ? 'text-accent-red animate-tick-pulse' : 'text-accent-gold'
            }`}
          >
            {tickCountdown}s
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => togglePanel('trade')}
          className="btn btn-xs btn-secondary text-base !px-2 !py-0.5"
          title="交易面板"
        >
          💼
        </button>
        <button
          onClick={() => togglePanel('company')}
          className="btn btn-xs btn-secondary text-base !px-2 !py-0.5"
          title="公司经营"
        >
          🏢
        </button>

        <span
          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-xl bg-bg-input ${
            wsConnected ? 'text-accent-green' : 'text-accent-red'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent-green' : 'bg-accent-red'}`}
          />
          {wsConnected ? '已连接' : '未连接'}
          {wsLatency > 0 && (
            <span className="ml-1.5 text-xs text-text-muted">{wsLatency}ms</span>
          )}
        </span>

        {playerCount > 0 && (
          <span className="text-xs text-text-muted">{playerCount}人在线</span>
        )}

        <span className="text-xs text-text-muted">{nickname}</span>
        <button onClick={clearAuth} className="btn btn-sm btn-secondary">
          退出
        </button>
      </div>
    </header>
  )
}

import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useGameStore } from '@/stores/gameStore'

interface HeaderProps {
  cash?: number | null
  nickname?: string | null
  globalQuarter?: number
}

export function Header({ cash, nickname: playerNickname, globalQuarter }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const authNickname = useAuthStore((s) => s.nickname)
  const nickname = playerNickname || authNickname
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const wsConnected = useGameStore((s) => s.wsConnected)
  const wsLatency = useGameStore((s) => s.wsLatency)
  const tickCountdown = useGameStore((s) => s.tickCountdown)
  const playerCount = useGameStore((s) => s.playerCount)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <header className="flex items-center justify-between gap-1 px-3 sm:px-5 py-2.5 bg-gradient-header border-b border-border shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="text-base sm:text-lg font-bold tracking-wider text-accent-gold whitespace-nowrap">
          大猫投资
        </span>
        <span className="hidden sm:inline text-xs px-2.5 py-0.5 rounded-xl bg-bg-input text-text-secondary whitespace-nowrap">
          入市请谨慎 · 投资有风险
        </span>
        {globalQuarter != null && globalQuarter > 0 && (
          <span className="hidden sm:inline text-xs px-2.5 py-0.5 rounded-xl bg-bg-input text-text-secondary whitespace-nowrap">
            第{Math.floor((globalQuarter - 1) / 4) + 1}年
          </span>
        )}
        {tickCountdown > 0 && (
          <span
            className={`text-sm font-semibold tabular-nums min-w-[28px] sm:min-w-[40px] ${
              tickCountdown <= 5 ? 'text-accent-red animate-tick-pulse' : 'text-accent-gold'
            }`}
          >
            {tickCountdown}s
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 text-xs h-6 px-2 rounded-xl bg-bg-input ${
              wsConnected ? 'text-accent-green' : 'text-accent-red'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent-green' : 'bg-accent-red'}`}
            />
            <span className="hidden sm:inline leading-none">{wsConnected ? '已连接' : '未连接'}</span>
            {wsLatency > 0 && (
              <span className="hidden md:inline leading-none text-text-muted">{wsLatency}ms</span>
            )}
          </span>

          {playerCount > 0 && (
            <span className="hidden md:inline h-6 inline-flex items-center text-xs text-text-muted whitespace-nowrap">
              {playerCount}人在线
            </span>
          )}

          <div className="relative inline-flex items-center h-6" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="h-6 inline-flex items-center text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer truncate max-w-[80px]"
            >
              {nickname}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-bg-card border border-border rounded shadow-lg min-w-[100px] z-50">
                <button
                  onClick={() => { clearAuth(); setMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-text-muted hover:text-accent-red hover:bg-white/[0.04] transition-colors whitespace-nowrap"
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>

        <span className="text-lg font-bold tracking-wide tabular-nums text-text-primary whitespace-nowrap">
          {cash != null ? `¥${cash.toLocaleString()}` : '¥--'}
        </span>
      </div>
    </header>
  )
}

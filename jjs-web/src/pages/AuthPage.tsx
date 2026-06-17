import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/api/client'

type AuthTab = 'login' | 'register'

interface LoginResponse {
  token: string
  player_id: string
  email: string
  nickname: string
  is_admin?: boolean
}

export function AuthPage() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const [tab, setTab] = useState<AuthTab>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')
  const [regNickname, setRegNickname] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.post<LoginResponse>('/auth/login', {
        email: loginEmail,
        password: loginPassword,
      })
      setAuth({
        token: data.token,
        playerId: data.player_id,
        email: data.email,
        nickname: data.nickname,
        isAdmin: data.is_admin,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (regPassword !== regPassword2) {
      setError('两次密码不一致')
      return
    }
    setLoading(true)
    try {
      const data = await api.post<LoginResponse>('/auth/register', {
        email: regEmail,
        password: regPassword,
        nickname: regNickname,
      })
      setAuth({
        token: data.token,
        playerId: data.player_id,
        email: data.email,
        nickname: data.nickname,
        isAdmin: data.is_admin,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.08),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(139,92,246,0.05),transparent_50%)]">
      <div className="bg-bg-secondary rounded-xl p-10 max-w-[400px] w-full border border-border shadow-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl mb-2">📈 大猫投资</h1>
          <p className="text-text-secondary text-[15px]">入市请谨慎 · 投资有风险</p>
        </div>

        <div className="flex border-b border-border mb-4">
          <button
            className={`flex-1 py-2.5 text-center text-sm font-semibold border-b-2 transition-colors ${
              tab === 'login'
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
            onClick={() => { setTab('login'); setError('') }}
          >
            登录
          </button>
          <button
            className={`flex-1 py-2.5 text-center text-sm font-semibold border-b-2 transition-colors ${
              tab === 'register'
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
            onClick={() => { setTab('register'); setError('') }}
          >
            注册
          </button>
        </div>

        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <FormGroup label="账号">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="请输入账号"
                required
              />
            </FormGroup>
            <FormGroup label="密码">
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="密码（至少8位）"
                required
              />
            </FormGroup>
            {error && <p className="text-accent-red text-sm min-h-5">{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary btn-full">
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <FormGroup label="账号">
              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="请输入账号"
                required
              />
            </FormGroup>
            <FormGroup label="密码">
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="密码（至少8位）"
                required
              />
            </FormGroup>
            <FormGroup label="确认密码">
              <input
                type="password"
                value={regPassword2}
                onChange={(e) => setRegPassword2(e.target.value)}
                placeholder="再次输入密码"
                required
              />
            </FormGroup>
            <FormGroup label="昵称">
              <input
                type="text"
                value={regNickname}
                onChange={(e) => setRegNickname(e.target.value)}
                placeholder="游戏内显示的名称"
                required
              />
            </FormGroup>
            {error && <p className="text-accent-red text-sm min-h-5">{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary btn-full">
              {loading ? '注册中...' : '注册'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-text-muted mt-4">
          * 首次登录即自动注册
        </p>
      </div>
    </div>
  )
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[13px] text-text-secondary">{label}</label>
      {children}
    </div>
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  playerId: string | null
  email: string | null
  nickname: string | null
  isAdmin: boolean
  isAuthenticated: boolean
  setAuth: (data: { token: string; playerId: string; email: string; nickname: string; isAdmin?: boolean }) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      playerId: null,
      email: null,
      nickname: null,
      isAdmin: false,
      isAuthenticated: false,
      setAuth: (data) =>
        set({
          token: data.token,
          playerId: data.playerId,
          email: data.email,
          nickname: data.nickname,
          isAdmin: data.isAdmin ?? false,
          isAuthenticated: true,
        }),
      clearAuth: () =>
        set({
          token: null,
          playerId: null,
          email: null,
          nickname: null,
          isAdmin: false,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'jjs-auth',
    }
  )
)

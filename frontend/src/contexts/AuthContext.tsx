import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { requestLogin } from '@/api/authApi'
import { ACCESS_TOKEN_KEY } from '@/api/client'
import type { AuthContextValue, LoginCredentials } from '@/types/auth'

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY),
  )

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await requestLogin(credentials)
    localStorage.setItem(ACCESS_TOKEN_KEY, response.accessToken)
    setAccessToken(response.accessToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    setAccessToken(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isAuthenticated: Boolean(accessToken),
      login,
      logout,
    }),
    [accessToken, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

import { createContext, useContext, type PropsWithChildren } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authService } from './authService'
import { profileService } from '@/features/profile/profileService'
import type {
  AuthUser,
  EmailAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

type AuthStatus = 'loading' | 'authenticated' | 'guest'

interface AuthContextValue {
  user: AuthUser | null
  status: AuthStatus
  login: (request: LoginRequest) => Promise<AuthUser>
  signup: (request: SignupRequest) => Promise<AuthUser>
  checkEmail: (email: string) => Promise<EmailAvailability>
  updateProfileImage: (file: File) => Promise<AuthUser>
  logout: () => Promise<void>
  updateDisplayName: (displayName: string) => Promise<AuthUser>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const authQueryKey = ['auth', 'me'] as const

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const authQuery = useQuery({
    queryKey: authQueryKey,
    queryFn: authService.getCurrentUser,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const user = authQuery.data ?? null
  const status: AuthStatus = authQuery.isPending
    ? 'loading'
    : user
      ? 'authenticated'
      : 'guest'

  const value: AuthContextValue = {
    user,
    status,
    async login(request) {
      const signedInUser = await authService.login(request)
      queryClient.setQueryData(authQueryKey, signedInUser)
      return signedInUser
    },
    signup: authService.signup,
    checkEmail: authService.checkEmail,
    async updateProfileImage(file) {
      const updatedUser = await profileService.updateProfileImage(file)
      queryClient.setQueryData(authQueryKey, updatedUser)
      return updatedUser
    },
    async logout() {
      await authService.logout()
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== 'auth',
      })
      queryClient.setQueryData(authQueryKey, null)
    },
    async updateDisplayName(displayName) {
      const updatedUser = await authService.updateDisplayName(displayName)
      queryClient.setQueryData(authQueryKey, updatedUser)
      return updatedUser
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth는 AuthProvider 안에서 사용해야 합니다.')
  return context
}

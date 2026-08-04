import { createContext, useContext, useState, type PropsWithChildren } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { releasePushSubscription } from '@/features/notification/releasePushSubscription'
import { authService } from './authService'
import { profileService } from '@/features/profile/profileService'
import type {
  AuthUser,
  EmailAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

type AuthStatus = 'loading' | 'authenticated' | 'guest'

/**
 * 로그인하지 않은 상태가 된 <b>경위</b>. 가드가 어디로 보낼지 정하는 유일한 근거다.
 *
 * <p>`status`만으로는 두 경우가 구분되지 않는다. 주소를 직접 열었거나 세션이 만료된 사람은 보던
 * 곳으로 돌아가고 싶어 하지만, 스스로 나간 사람(로그아웃·회원 탈퇴)에게 방금 나온 화면을 다시
 * 권하는 것은 이상하다 — 탈퇴한 사람에게는 돌아갈 계정조차 없다.
 */
export type GuestReason = 'never-signed-in' | 'signed-out'

interface AuthContextValue {
  user: AuthUser | null
  status: AuthStatus
  /** `status`가 `guest`일 때만 의미가 있다. */
  guestReason: GuestReason
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
  const [guestReason, setGuestReason] = useState<GuestReason>('never-signed-in')
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
    guestReason,
    async login(request) {
      const signedInUser = await authService.login(request)
      // 다음에 세션이 끊기면 그것은 만료지, 지난번에 스스로 나간 것이 아니다.
      setGuestReason('never-signed-in')
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
      /*
       * 세션이 살아 있을 때 먼저 끊는다 — 로그아웃 뒤에는 서버가 나를 모르므로 지울 수 없다.
       * 공용 PC에서 다음 사람에게 이전 계정의 알림이 뜨는 것을 막는다.
       */
      await releasePushSubscription()
      await authService.logout()
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== 'auth',
      })
      /*
       * 경위와 상태를 <b>같은 블록에서</b> 바꾼다. 사이에 await가 끼면 게스트가 된 렌더와 경위가
       * 갱신된 렌더가 갈라져, 가드가 한 번은 '만료'로 읽고 엉뚱한 곳으로 보낸다.
       */
      setGuestReason('signed-out')
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

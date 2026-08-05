type SessionExpiryListener = () => void

const listeners = new Set<SessionExpiryListener>()

/**
 * API 계층과 인증 상태를 직접 결합하지 않고 세션 만료만 전달한다. AuthProvider가 구독을 해제하므로
 * 테스트·HMR에서 리스너가 중복으로 쌓이지 않는다.
 */
export function subscribeToSessionExpiry(listener: SessionExpiryListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 401 응답을 받은 공용 API 클라이언트가 호출한다. */
export function notifySessionExpired() {
  listeners.forEach((listener) => listener())
}

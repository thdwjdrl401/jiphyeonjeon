const mockSetting = import.meta.env.VITE_USE_MOCK_API

/** 테스트는 항상 mock 데이터 소스를 쓴다(네트워크 의존 없이 결정적으로 돌아야 한다). */
export const isTestMode = import.meta.env.MODE === 'test'

export const isMockApiEnabled =
  isTestMode || mockSetting === 'true' || (import.meta.env.DEV && mockSetting !== 'false')

/**
 * 실제 네트워크 요청 차단은 테스트에서만 건다.
 *
 * dev에서도 막으면 mock을 켜 둔 상태에서는 이미 실 API로 옮긴 서비스조차 백엔드에 닿지 못해,
 * 서비스를 하나씩 갈아끼우는 점진 전환이 불가능해진다(전부 옮기기 전에는 켤 수 없는 스위치가 된다).
 * 테스트에서는 반대로 선택 경계를 우회한 요청이 실제로 나가면 안 되므로 계속 막는다.
 */
export const isNetworkBlocked = isTestMode

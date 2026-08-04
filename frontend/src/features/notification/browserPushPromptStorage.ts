const STORAGE_KEY = 'liveclass.browserPushPrompt.dismissedAt'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 사이트 자체 브라우저 알림 안내의 "나중에" 스누즈.
 *
 * <p>브라우저 지문 같은 것을 만들지 않는다 — 이 브라우저·계정에서 마지막으로 닫은 시각만
 * localStorage에 남긴다. 네이티브 권한창에서 거절한 경우는 이 스토리지가 아니라
 * `Notification.permission`이 `denied`로 이미 막으므로 따로 다루지 않는다.
 */
export function wasBrowserPushPromptDismissedRecently() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const dismissedAt = Number(raw)
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < SNOOZE_MS
  } catch {
    return false
  }
}

export function dismissBrowserPushPrompt() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // 저장 실패는 기능을 막지 않는다 — 이번 방문에서만 다시 보일 뿐이다.
  }
}

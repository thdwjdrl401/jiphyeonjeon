import { useState } from 'react'
import { dismissBrowserPushPrompt, wasBrowserPushPromptDismissedRecently } from './browserPushPromptStorage'
import { usePushSubscription } from './usePushSubscription'

interface BrowserPushPromptProps {
  /** 수강 중이거나 운영 중인 강의가 있어 실제로 알림을 받을 가치가 있는지. */
  eligible: boolean
}

const PREVIEW_QUERY_PARAM = 'previewBrowserPushPrompt'

/**
 * 로그인 후 대시보드에서 한 번 보여 주는 고정형 사이트 자체 안내.
 *
 * <p>여기서 "브라우저 알림 켜기"를 눌렀을 때만 {@code Notification.requestPermission()}을
 * 부른다({@link usePushSubscription}의 {@code enable}이 그 규칙을 이미 지킨다) — 페이지 진입
 * 즉시 네이티브 권한창을 띄우면 대부분 거절되고, 한 번 거절되면 이 브라우저에서는 사이트가
 * 다시 물을 방법이 없다. 그래서 사이트가 먼저 이유를 설명하고 동의를 받은 뒤에만 연다.
 *
 * <p>다섯 조건이 모두 맞을 때만 보인다: 로그인(이 컴포넌트가 렌더되는 것 자체가 로그인 화면),
 * Web Push 지원, 권한이 아직 `default`, 이 브라우저에 활성 구독 없음, 알림 받을 가치가 있는
 * 강의가 있음(`eligible`). 브라우저 지문 같은 것은 만들지 않는다 — 판단 근거는
 * `Notification.permission`·현재 구독 상태·"나중에"를 누른 시각(localStorage) 셋뿐이다.
 *
 * <p>로컬에서 VAPID 키 없이 모양을 확인할 때는 개발 서버에서만
 * `?previewBrowserPushPrompt=1`로 표시 조건을 건너뛴다. 운영 빌드에서는 이 쿼리를 무시한다.
 */
export default function BrowserPushPrompt({ eligible }: BrowserPushPromptProps) {
  const isPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get(PREVIEW_QUERY_PARAM) === '1'
  // 미리보기는 모양만 확인하는 공개 화면이다. 백엔드·VAPID 없이 열 수 있도록 API 조회도 시작하지 않는다.
  const push = usePushSubscription(!isPreview)
  const [dismissed, setDismissed] = useState(() => (
    isPreview ? false : wasBrowserPushPromptDismissedRecently()
  ))

  if (dismissed) return null
  if (isPreview) return renderPrompt(push.enable, () => setDismissed(true))
  if (!eligible) return null
  // 권한이 이미 결정돼 있으면(허용·거절 모두) 안내할 이유가 없다 — 거절은 되물을 수 없고, 허용은 이미 켜져 있다.
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return null
  if (push.state !== 'off') return null

  return renderPrompt(push.enable, () => {
    dismissBrowserPushPrompt()
    setDismissed(true)
  })
}

function renderPrompt(enable: () => Promise<void>, dismiss: () => void) {
  return (
    <div className="browser-push-prompt" role="status" aria-label="브라우저 알림 안내">
      <p className="browser-push-prompt__message">
        라이브 시작과 일정 변경을 놓치지 않도록 이 브라우저에서 알림을 받을까요?
      </p>
      <div className="browser-push-prompt__actions">
        <button
          className="button button--primary button--small"
          type="button"
          onClick={() => void enable()}
        >
          브라우저 알림 켜기
        </button>
        <button
          className="button button--ghost button--small"
          type="button"
          onClick={dismiss}
        >
          나중에
        </button>
      </div>
    </div>
  )
}

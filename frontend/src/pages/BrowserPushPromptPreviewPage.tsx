import BrowserPushPrompt from '@/features/notification/BrowserPushPrompt'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

/** 백엔드·로그인 없이 고정형 브라우저 알림 카드의 배치만 확인하는 개발 전용 화면. */
export default function BrowserPushPromptPreviewPage() {
  usePageTitle('브라우저 알림 카드 미리보기')

  return (
    <section className="section">
      <div className="container">
        <div className="workspace-page workspace-page--narrow">
          <PageHeader
            title="브라우저 알림 카드 미리보기"
            description="안내 카드는 문서 흐름을 밀지 않고 화면 정중앙에 고정됩니다."
          />
          <Panel title="레이아웃 확인 영역">
            <p>
              이 화면은 로그인과 VAPID 설정 없이 카드의 위치와 반응형 배치를 확인하기 위한
              개발 전용 페이지입니다.
            </p>
          </Panel>
        </div>
      </div>
      <BrowserPushPrompt eligible={false} />
    </section>
  )
}

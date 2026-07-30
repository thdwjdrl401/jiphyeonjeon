import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CurriculumPublishPanel from '@/features/curriculum/CurriculumPublishPanel'
import { evaluatePublishReadiness } from '@/features/curriculum/publishPreconditions'

/**
 * 게시 버튼의 활성/비활성과 비활성 사유 노출(ADR-0006).
 *
 * 화면을 통째로 띄우지 않고 패널만 렌더하는 이유: 시드 DRAFT 커리큘럼에는 강의가 7개 있어
 * "섹션·강의가 없는 상태"를 통합 테스트로 만들려면 생성 흐름을 통째로 타야 한다. 여기서 보려는 것은
 * 조건→버튼 상태→안내 문구의 대응이라 패널이 정확한 단위다.
 */
const LIFECYCLE_DRAFT = { tone: 'warning' as const, label: '비공개', description: '게시해야 수강생에게 보입니다.' }

function renderPanel(sectionCount: number, lessonCount: number, onPublish = vi.fn()) {
  render(
    <CurriculumPublishPanel
      isNewDraft
      lifecycleView={LIFECYCLE_DRAFT}
      totalLessonCount={lessonCount}
      readiness={evaluatePublishReadiness(sectionCount, lessonCount)}
      isPubliclyVisible={false}
      onPublish={onPublish}
      canDelete={false}
      isDeleting={false}
      onDelete={vi.fn()}
    />,
  )
  return { button: screen.getByRole('button', { name: '커리큘럼 게시' }), onPublish }
}

describe('커리큘럼 게시 카드', () => {
  it('섹션과 강의가 있으면 게시 버튼이 열리고 무엇이 공개되는지 알린다', async () => {
    const user = userEvent.setup()
    const { button, onPublish } = renderPanel(2, 5)

    expect(button).toBeEnabled()
    expect(screen.getByText(/모두 수강생에게 공개됩니다/).textContent).toContain('강의 5개')

    await user.click(button)
    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it.each([
    [0, 0, '커리큘럼을 게시하려면 섹션과 강의를 각각 1개 이상 추가해주세요.'],
    [2, 0, '커리큘럼을 게시하려면 강의를 1개 이상 추가해주세요.'],
  ])('섹션 %i·강의 %i면 버튼을 잠그고 사유를 보여 준다', async (sectionCount, lessonCount, reason) => {
    const { button, onPublish } = renderPanel(sectionCount, lessonCount)

    expect(button).toBeDisabled()
    // tooltip만으로는 터치 기기·스크린리더에서 닿기 어렵다 — 인접 안내로도 같은 문장을 보여 준다.
    expect(button).toHaveAttribute('title', reason)
    expect(screen.getByText(reason)).toBeInTheDocument()

    await userEvent.setup().click(button)
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('게시 가능할 때는 비활성 사유를 tooltip에 남기지 않는다', () => {
    const { button } = renderPanel(1, 1)
    expect(button).not.toHaveAttribute('title')
  })
})

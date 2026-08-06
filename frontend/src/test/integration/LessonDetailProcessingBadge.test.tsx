import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

/**
 * 강의 상세의 녹화 처리 배지.
 *
 * <p>[ADR-0092]가 라이브 종료 동선을 처리 현황 화면에서 <b>강의 상세로</b> 옮기면서, "상세가 이미
 * 준비 상태를 보여 준다"를 전제로 삼았다. 그런데 그 자리에는 <b>"VIDEO READY"가 문자열로 박혀</b>
 * 있었다 — 인코딩이 돌고 있든 실패했든 강사에게는 늘 "검수 가능"으로 보였고, 눌러 들어가면 재생이
 * 안 됐다. 그 전제를 실제로 지키는지 확인한다.
 *
 * <p>목은 첫 조회에서 아직 준비 전, 다음 조회에서 READY를 준다. 그래서 이 화면 하나로
 * "도는 중 → 끝남" 전이를 그대로 볼 수 있다.
 */
async function renderInstructorLesson(path: string) {
  await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
  window.history.pushState({}, '', path)
  return render(<App />)
}

/** 종료된 라이브 세션이 달린 강의. les-security는 OPEN이라 다시보기 패널이 뜨지 않는다. */
const ENDED_LESSON = '/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-orientation'

describe('강의 상세 — 녹화 처리 배지', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('처리가 끝나지 않았으면 배지가 돌고, 누르면 처리 화면으로 간다', async () => {
    await renderInstructorLesson(ENDED_LESSON)

    const badge = await screen.findByText('녹화 처리 중')
    const panel = badge.closest('.workspace-panel') as HTMLElement

    // 링크여야 한다 — span에 onClick만 붙으면 키보드로 못 누른다.
    const link = badge.closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toMatch(/\/processing$/)
    // 원이 돈다.
    expect(link!.querySelector('.status-pill__spinner')).not.toBeNull()

    /*
     * 아직 볼 것이 없으므로 검수 버튼을 내주지 않는다. 예전에는 이 버튼이 늘 있었고, 눌러
     * 들어가면 재생이 안 됐다.
     */
    expect(within(panel).queryByRole('link', { name: '미리보기·검수' })).not.toBeInTheDocument()
  })

  it('처리가 끝나면 원이 멈추고 검수로 들어갈 수 있다', async () => {
    await renderInstructorLesson(ENDED_LESSON)

    // 폴링이 한 번 더 돌면 목이 READY를 준다.
    const settled = await screen.findByText(/다시보기 공개됨|검수 대기/, undefined, { timeout: 5_000 })
    const panel = settled.closest('.workspace-panel') as HTMLElement
    const link = settled.closest('a')!
    expect(link.querySelector('.status-pill__spinner')).toBeNull()
    expect(link.getAttribute('href')).toMatch(/\/replay$/)
    expect(within(panel).getByRole('link', { name: '미리보기·검수' })).toBeInTheDocument()
  })
})

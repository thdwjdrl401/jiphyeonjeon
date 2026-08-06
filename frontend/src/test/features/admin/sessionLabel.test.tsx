import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { sessionIdFromRoomName, type SessionLabel } from '@/features/admin/adminService'
import SessionLabelCell from '@/features/admin/SessionLabelCell'

/**
 * 운영 콘솔이 "어느 강의인가"를 그리는 규칙.
 *
 * <p>지키려는 것은 셋이다 — <b>방 이름에서 세션 id를 꺼내는가</b>, <b>이름을 못 찾아도 행이 남는가</b>,
 * <b>링크가 공개 커리큘럼으로만 가는가</b>.
 *
 * <p>마지막이 중요하다. 강의 상세·처리 현황은 소유 강사나 수강생만 열 수 있고 ADMIN은 그 게이트를
 * 통과하지 않는다 — 눌리지 않는 링크를 두는 것은 없는 것보다 나쁘다.
 */
describe('운영 콘솔 세션 이름표', () => {
  const label = (overrides: Partial<SessionLabel> = {}): SessionLabel => ({
    sessionId: '62f5c761-6919-496d-942e-31ec8425d47e',
    lessonId: 'b3d9c2e1-4a77-4b0e-8f21-9c3d5a7e1b60',
    lessonTitle: '3주차 — 트리 순회',
    curriculumId: 'a1b2c3d4-1111-2222-3333-444455556666',
    curriculumTitle: '자료구조 심화',
    ...overrides,
  })

  describe('방 이름에서 세션 id 꺼내기', () => {
    it('session- 접두사를 떼고 UUID만 남긴다', () => {
      expect(sessionIdFromRoomName('session-62f5c761-6919-496d-942e-31ec8425d47e'))
        .toBe('62f5c761-6919-496d-942e-31ec8425d47e')
    })

    it('규약과 다른 이름은 세션으로 보지 않는다', () => {
      // LiveKit에는 우리가 만들지 않은 방도 있을 수 있다. 억지로 파싱하면 없는 세션을 조회한다.
      expect(sessionIdFromRoomName('lobby')).toBeNull()
      expect(sessionIdFromRoomName('session-not-a-uuid')).toBeNull()
      expect(sessionIdFromRoomName(null)).toBeNull()
      expect(sessionIdFromRoomName('')).toBeNull()
    })
  })

  it('강의 제목과 커리큘럼을 보여 주고, 커리큘럼만 링크한다', () => {
    render(
      <MemoryRouter>
        <SessionLabelCell sessionId={label().sessionId} label={label()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('3주차 — 트리 순회')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '자료구조 심화' })
    expect(link).toHaveAttribute('href', '/curriculums/a1b2c3d4-1111-2222-3333-444455556666')
    // UUID는 지우지 않는다 — 로그를 찾거나 문의를 받을 때 결국 필요한 값이다.
    expect(screen.getByText('62f5c761-6919-496d-942e-31ec8425d47e')).toBeInTheDocument()
  })

  /**
   * 유령 Egress가 이 경우다 — 세션이 이미 지워졌다. 정리해야 할 바로 그 행이므로 사라지면 안 된다.
   */
  it('이름을 못 찾아도 세션 id는 남긴다', () => {
    render(
      <MemoryRouter>
        <SessionLabelCell sessionId="62f5c761-6919-496d-942e-31ec8425d47e" label={undefined} />
      </MemoryRouter>,
    )

    expect(screen.getByText('이름을 찾을 수 없음')).toBeInTheDocument()
    expect(screen.getByText('62f5c761-6919-496d-942e-31ec8425d47e')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('커리큘럼 id가 없으면 제목만 두고 링크하지 않는다', () => {
    render(
      <MemoryRouter>
        <SessionLabelCell
          sessionId={label().sessionId}
          label={label({ curriculumId: null })}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('자료구조 심화')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

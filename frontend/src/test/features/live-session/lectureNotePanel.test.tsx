import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LectureNotePanel from '@/features/live-session/LectureNotePanel'
import type { LectureNoteView } from '@/features/live-session/liveSessionService.interface'

/**
 * 패널의 <b>상태</b>(비었을 때·정제 뒤·아직 못 받았을 때)를 지킨다.
 * 본문을 어떻게 그리는지와 계약이 금지한 것을 막는지는 `lectureNoteMarkdown.test.tsx`에 있다.
 *
 * <p>본문과 구조화 필드는 <b>같은 값에서 나온 두 표현</b>이라 어긋나지 않는 것이 계약이다.
 * 픽스처도 그 규칙을 지킨다 — 어긋난 픽스처로 통과하는 테스트는 실제를 검증하지 못한다.
 */
function note(overrides: Partial<LectureNoteView> = {}): LectureNoteView {
  return {
    coveredThroughSequence: 21,
    topics: [
      { topicId: 'topic-1', title: '필터 체인', keyPoints: ['순서가 결과를 바꾼다', '인증은 컨텍스트에 담긴다'] },
    ],
    markdown: '## 필터 체인\n\n- 순서가 결과를 바꾼다\n- 인증은 컨텍스트에 담긴다',
    status: 'CAPTURING',
    updatedAt: '2026-08-02T21:00:00+09:00',
    ...overrides,
  }
}

/** 노트가 아직 없는 상태. 본문과 구조화 필드가 함께 비어야 실제와 같다. */
function emptyNote(overrides: Partial<LectureNoteView> = {}) {
  return note({ topics: [], markdown: '', ...overrides })
}

describe('AI 실시간 강의 노트 패널', () => {
  it('서버가 준 노트를 그대로 그린다', async () => {
    render(<LectureNotePanel live note={note()} />)

    // 제목(topics[].title)은 즉시 그려진다 — 본문(keyPoints)만 지연 로드되는 렌더러를 탄다.
    expect(screen.getByRole('heading', { name: '필터 체인' })).toBeInTheDocument()
    expect(await screen.findByText('순서가 결과를 바꾼다')).toBeInTheDocument()
    expect(screen.getByText('1개 주제')).toBeInTheDocument()
  })

  it('노트가 없으면 비어 있다고 말한다 — 예시를 지어내지 않는다', () => {
    render(<LectureNotePanel live note={emptyNote()} />)

    expect(screen.getByText(/아직 정리된 노트가 없습니다/)).toBeInTheDocument()
  })

  it('끝난 강의에서 노트가 없으면 기다리라고 하지 않는다', () => {
    render(<LectureNotePanel live={false} note={emptyNote()} />)

    expect(screen.getByText(/노트가 만들어지지 않았습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/정리하고 있어요/)).not.toBeInTheDocument()
  })

  it('정제가 끝나면 더 자란다고 하지 않는다', () => {
    render(<LectureNotePanel live note={note({ status: 'REFINED' })} />)

    // 계속 기다리게 두면 안 된다 — REFINED 뒤에는 새 주제가 추가되지 않는다.
    expect(screen.queryByText(/정리하고 있어요/)).not.toBeInTheDocument()
    expect(screen.getByText(/한 번 더 정리했습니다/)).toBeInTheDocument()
  })

  it('아직 아무것도 못 받았어도 깨지지 않는다', () => {
    render(<LectureNotePanel live note={null} />)
    expect(screen.getByText('0개 주제')).toBeInTheDocument()
    expect(screen.getByText(/아직 정리된 노트가 없습니다/)).toBeInTheDocument()
  })
})

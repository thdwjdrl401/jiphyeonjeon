import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import LectureNotePanel from '@/features/live-session/LectureNotePanel'
import type { LectureNoteView } from '@/features/live-session/liveSessionService'

/**
 * 강의 노트는 서버가 준 Markdown을 <b>그대로</b> 그린다.
 *
 * <p>예전에는 화면이 `topics[].keyPoints`를 직접 `<ul><li>`로 강제해서, 계약이 허용하는
 * 굵게·인라인 코드가 `**이렇게**` 글자로 남았다.
 *
 * <p>여기서 함께 지키는 것은 <b>계약이 금지한 것을 실제로 막는가</b>이다(공유 계약 §3-4a —
 * raw HTML·image·외부 link 불가). 렌더러를 바꿔 끼우다 이게 풀리면 노트가 곧 공격면이 된다.
 */
/**
 * 패널이 이제 주제별(topics[].keyPoints)로 그린다 — `markdown`은 그중 어떤 문법을 허용·차단하는지
 * 검증할 원본 텍스트일 뿐이라, 여기서 같은 문자열로부터 topics를 함께 뽑아 둘이 어긋나지 않게 한다
 * (그러지 않으면 이 파일의 markdown만 다양하게 바꾸는 픽스처가, 실제로 그려지는 topics와
 * 따로 놀아 문법 검증이 무의미해진다).
 */
function deriveTopics(markdown: string): LectureNoteView['topics'] {
  const keyPoints = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
  if (keyPoints.length === 0) return []
  const title = markdown.match(/^##\s+(.+)$/m)?.[1] ?? '주제'
  return [{ topicId: 't1', title, keyPoints }]
}

function note(markdown: string, extra: Partial<LectureNoteView> = {}): LectureNoteView {
  return {
    coveredThroughSequence: 12,
    topics: deriveTopics(markdown),
    markdown,
    status: 'CAPTURING',
    updatedAt: '2026-08-03T10:00:00Z',
    ...extra,
  }
}

function renderNote(markdown: string, extra: Partial<LectureNoteView> = {}) {
  return render(<LectureNotePanel note={note(markdown, extra)} live />)
}

/**
 * 지연 로드되는 Markdown 렌더러를 <b>미리 데운다.</b>
 *
 * <p>{@link Markdown}은 `react-markdown`·`remark-gfm`을 `React.lazy`로 끌어온다(로그인 화면
 * 번들에 넣지 않으려고). 테스트에서는 그 첫 import가 Vite 변환까지 포함해 실제로 오래 걸리는데,
 * 그 비용을 `findBy*` 안에서 치르면 부하가 걸린 러너에서 asyncUtilTimeout(5초)을 넘긴다 —
 * 2026-08-06 CI에서 9.8초가 걸려 깨졌다. 렌더가 안 된 것이 아니라 못 기다린 것이다.
 *
 * <p>여기서 한 번 지불하면 이후 렌더는 모듈 캐시를 타므로, 단언은 다시 "화면이 그리는가"만 본다.
 */
beforeAll(async () => {
  await import('@/shared/ui/MarkdownBody')
}, 120_000)

describe('강의 노트 Markdown', () => {
  it('제목과 목록을 문법이 아니라 구조로 그린다', async () => {
    renderNote('## 인증 흐름\n\n- 필터 체인을 먼저 통과한다\n- 결과는 컨텍스트에 담긴다')

    // 제목(topics[].title)은 즉시 그려진다 — 목록(keyPoints)만 지연 로드되는 렌더러를 탄다.
    expect(screen.getByRole('heading', { name: '인증 흐름' })).toBeInTheDocument()
    await screen.findAllByRole('listitem')
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      '필터 체인을 먼저 통과한다',
      '결과는 컨텍스트에 담긴다',
    ])
    // 문법 기호가 글자로 남지 않는다.
    expect(screen.queryByText(/^##/)).not.toBeInTheDocument()
  })

  it('굵게와 인라인 코드를 살린다', async () => {
    // 계약이 허용하는 인라인 문법이다. 예전 렌더링에서는 별표와 백틱이 그대로 보였다.
    const { container } = renderNote('- **SecurityContext**는 `Authentication`을 담는다')

    // 패널 머리말에도 <strong>이 있으므로 본문 안으로 범위를 좁힌다.
    const body = () => container.querySelector('.note-markdown')
    await waitFor(() => expect(body()?.querySelector('strong')).not.toBeNull())
    expect(body()?.querySelector('strong')?.textContent).toBe('SecurityContext')
    expect(body()?.querySelector('code')?.textContent).toBe('Authentication')
    expect(body()?.textContent).not.toContain('**')
  })

  it('raw HTML을 그리지 않는다', async () => {
    // rehype-raw를 넣지 않았으므로 태그가 글자로 남는다. 스크립트가 섞여 와도 실행되지 않는다.
    const { container } = renderNote('- <img src=x onerror="alert(1)"> 위험\n- <b>굵게</b>')

    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(2))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    // 태그가 해석되지 않고 글자로 남았는지 — 여기서 <b>가 살아나면 raw HTML이 열린 것이다.
    expect(container.querySelector('.note-markdown b')).toBeNull()
  })

  it('링크와 이미지는 지우되 글자는 남긴다', async () => {
    // 모델이 지어낸 주소가 클릭 가능한 링크로 남으면 그것만으로 피싱 표면이 된다.
    const { container } = renderNote('- [우리 문서](https://evil.example.com/login)를 보세요\n- ![그림](https://evil.example.com/a.png)')

    await waitFor(() => expect(container.querySelectorAll('li').length).toBe(2))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // 지웠다고 문장에 구멍이 나면 안 된다.
    expect(container.textContent).toContain('우리 문서를 보세요')
  })

  it('본문이 비면 주제가 있어도 비었다고 말한다', async () => {
    // 구조화 필드만 오고 Markdown이 빈 어긋난 상태에서, "1개 주제" 아래 빈 화면이 나오면 안 된다.
    renderNote('   ')
    expect(await screen.findByText(/아직 정리된 노트가 없습니다/)).toBeInTheDocument()
  })

  it('주제 개수는 구조화 필드에서 센다', async () => {
    renderNote('## 하나\n\n- 요점', {
      topics: [
        { topicId: 't1', title: '하나', keyPoints: ['요점'] },
        { topicId: 't2', title: '둘', keyPoints: ['요점'] },
      ],
    })
    expect(await screen.findByText('2개 주제')).toBeInTheDocument()
  })

  it('종료된 강의에는 더 만들어진다는 안내를 두지 않는다', async () => {
    render(<LectureNotePanel note={note('## 끝\n\n- 요점', { status: 'REFINED' })} live={false} />)
    expect(await screen.findByRole('heading', { name: '끝' })).toBeInTheDocument()
    expect(screen.queryByText(/다음 구간을 정리하고 있어요/)).not.toBeInTheDocument()
  })
})

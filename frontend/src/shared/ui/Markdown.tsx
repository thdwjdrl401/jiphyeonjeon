import { lazy, Suspense } from 'react'

/**
 * Markdown 본문 렌더러. <b>강의 노트</b>와 <b>AI 답변</b>이 함께 쓴다.
 *
 * <p><b>왜 지연 로드인가.</b> 라우트가 코드 분할돼 있지 않아(`AppRouter`가 페이지를 직접 import)
 * 여기서 바로 import하면 react-markdown·remark-gfm이 <b>로그인 화면 번들에도</b> 들어간다.
 * 강의를 듣는 사람만 받으면 되는 것이다 — 플레이어·판서가 이미 같은 방식을 쓴다.
 *
 * <p>허용 문법과 막는 것은 {@link ./MarkdownBody}에 있다.
 *
 * <p><b>글자 크기·색은 여기서 정하지 않는다.</b> `.markdown`은 여백과 코드·표 같은 구조만 잡고,
 * 쓰는 쪽이 `className`으로 자기 크기를 얹는다(`.note-markdown`은 주제 구분선까지 더한다).
 * 노트는 사이드바 본문 크기, AI 답변은 말풍선 크기라 둘을 한 값으로 묶을 수 없다.
 */
const MarkdownBody = lazy(() => import('./MarkdownBody'))

interface Props {
  markdown: string
  /** 쓰는 쪽의 글자 크기·여백을 얹는다. `.markdown`과 함께 붙는다. */
  className?: string
}

export default function Markdown({ markdown, className }: Props) {
  return (
    <div className={className ? `markdown ${className}` : 'markdown'}>
      {/* 폴백은 자리만 지킨다 — 스피너를 넣으면 짧은 로드에 깜빡임만 남는다. */}
      <Suspense fallback={<p className="markdown__loading">내용을 그리는 중입니다.</p>}>
        <MarkdownBody markdown={markdown} />
      </Suspense>
    </div>
  )
}

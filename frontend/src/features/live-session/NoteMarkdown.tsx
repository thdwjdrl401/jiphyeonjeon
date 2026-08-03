import { lazy, Suspense } from 'react'

/**
 * 강의 노트 Markdown.
 *
 * <p><b>왜 지연 로드인가.</b> 라우트가 코드 분할돼 있지 않아(`AppRouter`가 페이지를 직접 import)
 * 여기서 바로 import하면 react-markdown·remark-gfm이 <b>로그인 화면 번들에도</b> 들어간다.
 * 강의 노트를 여는 사람만 받으면 되는 것이다 — 플레이어·판서가 이미 같은 방식을 쓴다.
 *
 * <p>허용 문법과 막는 것은 {@link ./NoteMarkdownBody}에 있다.
 */
const NoteMarkdownBody = lazy(() => import('./NoteMarkdownBody'))

interface Props {
  markdown: string
}

export default function NoteMarkdown({ markdown }: Props) {
  return (
    <div className="note-markdown">
      {/* 폴백은 자리만 지킨다 — 스피너를 넣으면 짧은 로드에 깜빡임만 남는다. */}
      <Suspense fallback={<p className="note-markdown__loading">노트를 그리는 중입니다.</p>}>
        <NoteMarkdownBody markdown={markdown} />
      </Suspense>
    </div>
  )
}

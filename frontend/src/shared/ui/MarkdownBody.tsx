import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeCodeHighlight from './rehypeCodeHighlight'

/**
 * 실제 렌더러. <b>이 모듈만</b> react-markdown·remark-gfm을 import한다 —
 * {@link ./Markdown}이 이 파일을 지연 로드해 별도 청크로 떼어낸다.
 *
 * <p>쓰는 곳은 둘이고 성격이 다르다. <b>강의 노트</b>는 계약이 문법을 정해 두었고(공유 계약 §3-4a —
 * heading·목록·굵게·인라인 코드), <b>AI 답변</b>은 형식 계약이 없어 모델이 주는 대로 온다
 * (`answer.delta.text`에 형식 제약이 없다). 그래서 <b>넓게 그리되 위험한 것만 막는</b> 쪽으로 맞춘다.
 *
 * <ul>
 *   <li><b>raw HTML</b>은 react-markdown이 기본으로 그리지 않는다(rehype-raw를 넣지 않았다).
 *       그래서 `&lt;script&gt;`나 `&lt;img onerror=…&gt;`가 섞여 와도 글자로 남는다.</li>
 *   <li><b>이미지·링크는 지운다.</b> 다만 <b>글자는 남긴다</b>(`unwrapDisallowed`) — 링크를 걷어냈다고
 *       문장에 구멍이 나면 안 된다. 주소를 글자로 쓴 경우엔 주소도 그대로 보인다.
 *       <b>감추는 것이 아니라 클릭만 막는 것이다.</b></li>
 * </ul>
 *
 * <p><b>왜 링크를 막나.</b> 노트도 답변도 자막·PPTX에서 만들어진다 — 그 안에 웹 주소가 없으니 링크가
 * 나온다면 <b>모델이 지어낸 것</b>이다. 그것이 파란 밑줄로 그려지면 학생은 강의가 준 자료로 읽고 누른다.
 * 도메인이 실제로 존재하고 남의 것이면 그 순간 피싱이다. 이미지도 같다 — `src`를 그리는 순간 브라우저가
 * 그 서버로 요청을 보내므로, 안 깨지는 이미지는 누군가 우리 학생의 접속을 받고 있다는 뜻이다.
 * 검증된 출처는 따로 그린다(AI 답변은 `AiEvidenceList`, 노트는 자막 구간).
 *
 * <p>GFM을 켜는 것은 문법을 넓히려는 것이 아니라, 표·취소선처럼 우리가 기대하지 않은 문법이 섞여 와도
 * 원문이 그대로 노출되지 않게 하려는 것이다.
 *
 * <p><b>문법 강조는 언어를 밝힌 코드에만 건다</b>(`detect: false`, ADR-0097). 자동 감지를 켜면 짧은
 * 조각에서 자주 틀리는데, <b>여기는 코드를 가르치는 화면</b>이라 잘못 칠한 색이 색이 없는 것보다 나쁘다.
 * ` ```java `처럼 언어가 붙어 오면 칠하고, 없으면 예전처럼 등폭 글꼴 상자로만 남는다.
 */
interface Props {
  markdown: string
}

export default function MarkdownBody({ markdown }: Props) {
  return (
    <Markdown
      disallowedElements={['img', 'a']}
      rehypePlugins={[rehypeCodeHighlight]}
      remarkPlugins={[remarkGfm]}
      unwrapDisallowed
    >
      {markdown}
    </Markdown>
  )
}

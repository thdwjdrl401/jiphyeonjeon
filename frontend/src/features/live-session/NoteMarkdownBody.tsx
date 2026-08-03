import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 실제 렌더러. <b>이 모듈만</b> react-markdown·remark-gfm을 import한다 —
 * {@link ../NoteMarkdown}이 이 파일을 지연 로드해 별도 청크로 떼어낸다.
 *
 * <p>계약이 허용하는 범위(공유 계약 §3-4a): heading, unordered list, bold, inline code.
 * raw HTML·image·외부 link는 허용하지 않는다.
 *
 * <ul>
 *   <li><b>raw HTML</b>은 react-markdown이 기본으로 그리지 않는다(rehype-raw를 넣지 않았다).
 *       그래서 `<script>`나 `<img onerror=…>`가 노트에 섞여 와도 글자로 남는다.</li>
 *   <li><b>이미지·링크는 지운다.</b> 계약에 없을 뿐 아니라, 모델이 지어낸 주소가 노트 안에
 *       클릭 가능한 링크로 남으면 그것만으로 피싱 표면이 된다. 다만 <b>글자는 남긴다</b>
 *       (`unwrapDisallowed`) — 링크를 걷어냈다고 문장에 구멍이 나면 안 된다.</li>
 * </ul>
 *
 * <p>GFM을 켜는 것은 계약을 넓히려는 것이 아니라, 표·취소선처럼 계약 밖 문법이 섞여 와도
 * 원문이 그대로 노출되지 않게 하려는 것이다.
 */
interface Props {
  markdown: string
}

export default function NoteMarkdownBody({ markdown }: Props) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} disallowedElements={['img', 'a']} unwrapDisallowed>
      {markdown}
    </Markdown>
  )
}

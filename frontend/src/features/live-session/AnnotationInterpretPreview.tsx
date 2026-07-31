import type { AnnotationInterpretation } from './annotationInterpret'

/**
 * 해석 결과를 <b>적용 전에</b> 보여 준다(ADR-0054 결정 6).
 *
 * <p><b>왜 항상 확인받는가.</b> 모델이 낸 `confidence`를 근거로 쓸 수 없기 때문이다. 실측에서
 * 손그림 다이어그램의 한글 라벨을 `요청` → `유정`으로 잘못 읽고도 <b>1.0</b>을 줬다. "확신도가
 * 낮을 때만 확인받는다"는 규칙은 그래서 성립하지 않는다.
 *
 * <p>강의 중에 원본을 지우고 틀린 것으로 바꾸는 사고는 되돌리기 어렵다 — 수강생은 이미 봤고
 * 녹화에도 남는다. 한 번 더 보는 비용이 훨씬 싸다.
 */

interface AnnotationInterpretPreviewProps {
  result: AnnotationInterpretation
  applying: boolean
  onApply: () => void
  onCancel: () => void
}

export default function AnnotationInterpretPreview({
  result,
  applying,
  onApply,
  onCancel,
}: AnnotationInterpretPreviewProps) {
  if (result.unreadable) {
    return (
      <div className="annotation-interpret-preview" role="dialog" aria-label="판서 해석 결과">
        <p className="annotation-interpret-preview__empty">
          판서를 알아보지 못했습니다. 더 또렷하게 그린 뒤 다시 시도해 주세요.
        </p>
        <div className="annotation-interpret-preview__actions">
          <button type="button" onClick={onCancel}>닫기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="annotation-interpret-preview" role="dialog" aria-label="판서 해석 결과">
      <p className="annotation-interpret-preview__title">
        {result.kind === 'mermaid' ? '다이어그램으로 읽었습니다' : '수식으로 읽었습니다'}
      </p>
      {/* 원문을 그대로 보여 준다 — 라벨 오독은 여기서만 잡힌다. */}
      <pre className="annotation-interpret-preview__body">{result.body}</pre>
      <p className="annotation-interpret-preview__note">
        적용하면 선택한 판서 {result.replace.length}개를 지우고 이것으로 바꿉니다.
      </p>
      <div className="annotation-interpret-preview__actions">
        <button type="button" onClick={onCancel} disabled={applying}>취소</button>
        <button
          type="button"
          className="is-primary"
          onClick={onApply}
          disabled={applying}
          aria-busy={applying}
        >
          {applying ? '적용하는 중…' : '적용'}
        </button>
      </div>
    </div>
  )
}

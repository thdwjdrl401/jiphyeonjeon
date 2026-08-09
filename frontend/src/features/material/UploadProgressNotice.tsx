interface UploadProgressNoticeProps {
  /** 지금 무엇을 하고 있는지. 사용자의 말로 쓴다("영상 업로드 중"), 단계 이름 그대로 쓰지 않는다. */
  label: string
  /** 0~1. null이면 전체 크기를 모르는 것이라 막대를 확정 진행으로 그리지 않는다. */
  ratio: number | null
}

function percent(ratio: number) {
  // 100%에서 멈춘 것처럼 보이지 않게 한다 — 전송이 끝나도 서버 응답이 남아 있다.
  return Math.min(99, Math.floor(ratio * 100))
}

/**
 * 업로드 진행 막대. 폼 제출 중에만 뜬다.
 *
 * 비율을 모를 때는 `<progress>`를 값 없이 그린다 — 브라우저가 부정형(indeterminate) 막대로
 * 그려 준다. 0%로 채우면 "멈췄다"로 읽힌다.
 */
export default function UploadProgressNotice({ label, ratio }: UploadProgressNoticeProps) {
  return (
    <div className="upload-progress" role="status" aria-live="polite">
      <div className="upload-progress__line">
        <span className="upload-progress__label">{label}</span>
        {ratio !== null && <span className="upload-progress__percent">{percent(ratio)}%</span>}
      </div>
      <progress
        className="upload-progress__bar"
        max={100}
        value={ratio === null ? undefined : percent(ratio)}
      />
    </div>
  )
}

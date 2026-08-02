import {
  CAMERA_QUALITIES,
  SCREEN_QUALITIES,
  type PublishQuality,
} from './publishQuality'

/**
 * 송출 화질 선택. 카메라와 화면공유를 따로 고른다 — 같은 강의에서도 얼굴은 낮춰도 되지만
 * 코드 슬라이드는 글자가 읽혀야 하는 경우가 있다.
 *
 * <p>기본값은 최고 화질이고 강사는 <b>낮추는 방향으로만</b> 조정한다. 선택은 브라우저에 남아
 * 다음 강의에서 다시 고르지 않아도 된다.
 *
 * <p>바꾸면 이미 올라간 트랙만 껐다 다시 올린다. 그 사이 잠깐 미리보기가 멈추므로 적용 중에는
 * 버튼을 잠근다 — 연달아 누르면 재발행이 겹친다.
 */
interface Props {
  quality: PublishQuality
  applying: boolean
  onChange: (next: Partial<PublishQuality>) => void
}

export default function PublishQualityPanel({ quality, applying, onChange }: Props) {
  return (
    <div aria-label="송출 화질" className="quality-panel" role="group">
      <fieldset disabled={applying}>
        <legend>카메라</legend>
        {CAMERA_QUALITIES.map((option) => (
          <button
            aria-pressed={quality.camera === option.id}
            className={quality.camera === option.id ? 'is-active' : ''}
            key={option.id}
            title={option.hint}
            type="button"
            onClick={() => onChange({ camera: option.id })}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      <fieldset disabled={applying}>
        <legend>화면 공유</legend>
        {SCREEN_QUALITIES.map((option) => (
          <button
            aria-pressed={quality.screenShare === option.id}
            className={quality.screenShare === option.id ? 'is-active' : ''}
            key={option.id}
            title={option.hint}
            type="button"
            onClick={() => onChange({ screenShare: option.id })}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      {/* 지금 고른 것이 왜 그런지 한 줄로 남긴다 — 라벨만으로는 무엇을 잃는지 알 수 없다. */}
      <p className="quality-panel__hint">
        {CAMERA_QUALITIES.find((option) => option.id === quality.camera)?.hint}
      </p>
      {applying && <p className="quality-panel__hint" role="status">화질을 적용하는 중입니다…</p>}
    </div>
  )
}

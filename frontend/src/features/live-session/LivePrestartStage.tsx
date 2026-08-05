import { formatScheduledAt, prestartHeadline, prestartNotice } from './livePrestart'

/**
 * 강사가 아직 시작하지 않은 강의실의 영상 자리.
 *
 * <p>입장창은 <b>시계가 연다</b>(예정 시각 −N분) — 강사가 여는 것이 아니다. 그래서 시작 전에도 이
 * 화면에 사람이 있고, 그 사람에게는 볼 것이 없다. 예전에는 이 자리에 그냥 플레이어를 그렸는데,
 * 녹화 자산은 시작 시점에 생기므로 재생 조회가 실패하면서 <b>"시청할 수 있는 영상이 없습니다"</b>라는
 * 오류가 떴다 — 기다리면 되는 상황을 고장으로 읽히게 했다.
 *
 * <p>플레이어와 같은 {@code video-stage} 틀에 {@code student-live-empty}를 그대로 쓴다. 시작되면 이
 * 자리에 플레이어가 들어오는데, 틀이 다르면 전환할 때 레이아웃이 한 번 튄다.
 *
 * <p>{@code role="status"}다 — 기다림은 오류가 아니고, 시작 신호를 받아 문구가 바뀔 때 보조기술이
 * 스스로 읽어 주어야 한다(시작을 알아채는 것이 이 화면의 전부다).
 */
export default function LivePrestartStage({
  lessonTitle,
  scheduledAt,
  isStarting,
}: {
  lessonTitle: string
  /** 예정 시각. 없으면 시각 줄을 생략한다 — 모르는 것을 지어내지 않는다. */
  scheduledAt: string | null
  isStarting: boolean
}) {
  const scheduled = formatScheduledAt(scheduledAt)
  return (
    <div aria-label="강의 영상" className="video-stage student-live-stage" role="region">
      <div className="student-live-empty" role="status">
        <strong>{prestartHeadline(isStarting)}</strong>
        <p>{prestartNotice(isStarting)}</p>
        {scheduled && <p>예정 시각 {scheduled}</p>}
      </div>

      <header className="student-live-status" aria-label="재생 정보">
        <div>
          {/* LIVE 표시를 켜지 않는다 — 아직 라이브가 아니다. */}
          <strong>{isStarting ? '시작하는 중' : '시작 전'}</strong>
          <span>{lessonTitle}</span>
        </div>
      </header>
    </div>
  )
}

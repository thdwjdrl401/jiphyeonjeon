import { useInstructorLiveKit } from './useInstructorLiveKit'

/**
 * "지금 데모 영상을 송출 중"이라고 강의 내내 말한다(ADR-0100).
 *
 * <p>데모 모드의 화면은 평소와 <b>완전히 같다</b> — 그게 이 기능의 목적이자 위험이다. 말해 주지
 * 않으면 진짜 수업에 켜 둔 채로 들어간 것을 알아챌 방법이 없다.
 *
 * <p>파일을 잃은 상태(새로고침)도 여기서 말한다. 그때는 카메라로 자동 전환하지 <b>않으므로</b>
 * 화면이 검은데, 이유를 모르면 장애로 보인다.
 */
export default function DemoPublishBanner() {
  const { demoPublish } = useInstructorLiveKit()
  if (!demoPublish.armed) return null

  return (
    <div className="live-session-state-banner is-demo" role="status">
      {demoPublish.ready
        ? <>데모 영상을 송출 중입니다 — 카메라·마이크 대신 <b>{demoPublish.fileName}</b>이 나갑니다.</>
        : <>데모로 설정돼 있지만 영상이 없습니다. 카메라로 전환하지 않았으니 사전 점검에서 다시 선택해 주세요.</>}
    </div>
  )
}

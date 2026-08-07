/**
 * 마이크·카메라 아이콘. 꺼지면 <b>사선</b>이 그어진다.
 *
 * <p>사선은 Zoom·Meet가 공유하는 규약이라 배울 필요가 없는 기호다. 상태를 글자(`켜짐`/`꺼짐`)로
 * 적으면 버튼이 두 배로 길어지는데, 이 줄에는 버튼이 예닐곱 개 선다.
 *
 * <p><b>붉은색은 쓰지 않는다.</b> Meet는 음소거를 붉게 채우지만, 이 제품에서 붉은색은 이미
 * <b>LIVE</b>다(`.status-pill--live`). 같은 화면에서 붉은색이 "방송 중"과 "마이크 꺼짐" 둘을 뜻하면
 * 지금 없애려는 혼란을 다른 자리에 다시 만든다. 상태는 사선과 채움이 진다.
 */
export default function MediaToggleIcon({ kind, off }: { kind: 'microphone' | 'camera'; off: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="media-toggle-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {kind === 'microphone' ? (
        <>
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 18v4" />
        </>
      ) : (
        <>
          <path d="M2 7.5A1.5 1.5 0 0 1 3.5 6h10A1.5 1.5 0 0 1 15 7.5v9A1.5 1.5 0 0 1 13.5 18h-10A1.5 1.5 0 0 1 2 16.5Z" />
          <path d="m15 11 6-3.5v9L15 13Z" />
        </>
      )}
      {off && <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  )
}

import type { ChatMessageView } from './liveSessionService.interface'

/**
 * 다시보기에서 "지금 재생 위치까지 올라온 채팅"만 고른다.
 *
 * <p>다시보기 화면은 세션 전체를 한 번에 불러온다. 그대로 그리면 <b>아직 오지 않은 미래</b>가 먼저
 * 떠 있다 — 0:00인데 강의 끝 무렵 질문이 목록 맨 아래에 보인다. 라이브를 겪은 사람이 다시 볼 때
 * 기대하는 모양이 아니고, 무엇보다 그 질문이 무엇에 대한 것인지 알 수 없다.
 *
 * <p>그래서 재생 위치를 <b>커서</b>로 쓴다. 커서까지가 보이고, 최신이 맨 아래에 오고, 재생하면
 * 아래로 자라고, 되감으면 줄어든다. 자막이 이미 쓰는 규칙(`selectVisibleCaptions`)과 같은 모양이다 —
 * 한 화면에서 두 목록이 서로 다른 시각을 보여 주면 안 된다.
 *
 * <p><b>`positionMs`가 null이면 전부 보인다.</b> 라이브처럼 지금이 곧 최신이라 자를 이유가 없는
 * 자리다.
 *
 * <p><b>세션-ms가 없는 항목은 자르지 않는다.</b> 방금 보낸 낙관적 항목은 서버가 시각을 확정하기
 * 전이라 좌표가 없다 — 여기서 숨기면 내가 쓴 말이 사라진 것처럼 보인다. 라이브에서만 생기는
 * 상태지만, 규칙은 목록이 어디서 오든 같아야 한다.
 */
export function selectVisibleMessages(
  messages: ChatMessageView[],
  positionMs: number | null,
): ChatMessageView[] {
  if (positionMs == null) return messages
  return messages.filter((message) => message.sessionMs == null || message.sessionMs <= positionMs)
}

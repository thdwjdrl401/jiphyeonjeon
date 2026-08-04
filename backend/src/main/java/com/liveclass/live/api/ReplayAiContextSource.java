package com.liveclass.live.api;

import java.util.Optional;
import java.util.UUID;

/**
 * 다시보기 AI 질문에 필요한 세션 문맥 조회 포트(ADR-0042). video가 재생 인가와 "어느 세션인가"를
 * 끝낸 뒤 부른다 — 인가는 이 포트의 책임이 아니다.
 *
 * <p>포트를 따로 둔 이유는 <b>시간축 변환이 live의 것</b>이기 때문이다. 자막의 원좌표는 attempt-local
 * {@code streamElapsedMs}이고, 세션 시간으로 옮기려면 {@code caption.stream.started}의
 * {@code audioStartedAt} 앵커가 필요한데(ADR-0052) 둘 다 live 모듈 안에 있다. video가 이걸 직접
 * 계산하려면 live의 엔티티를 열어야 하고, 그건 모듈 경계 위반이다.
 */
public interface ReplayAiContextSource {

    /**
     * 질문 시점 주변의 확정 자막과 커리큘럼을 모은다.
     *
     * @param sessionId         재생 자산이 가리키는 라이브 세션
     * @param questionSessionMs 질문을 누른 순간의 재생 위치(세션 상대 ms)
     * @return 세션이 없으면 {@link Optional#empty()} — 호출자가 자기 도메인의 404로 옮긴다
     */
    Optional<ReplayAiContext> resolve(UUID sessionId, long questionSessionMs);
}

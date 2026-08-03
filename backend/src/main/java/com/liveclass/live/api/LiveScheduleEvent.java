package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 일정이 정해지거나 바뀌거나 취소됐다. 그 커리큘럼을 <b>수강 중인 학생 전원</b>이 알아야 한다.
 *
 * <p>셋을 한 사건으로 묶은 이유는 <b>같은 것을 알리기 때문</b>이다 — "이 강의를 언제 하는가". 받는
 * 사람도 같고, 문구 자리도 같고, 나뉘면 리스너가 세 벌이 된다.
 *
 * <p>강의 제목이 없다. 라이브 세션은 제목을 갖지 않고 레슨이 갖는데, 그것을 실으려면 이 모듈이
 * lesson을 조회해야 한다. 문구는 어차피 워커가 만들므로 <b>거기서 제목을 찾는다</b> — 조회를
 * 업무 트랜잭션 밖으로 미루는 편이 낫다(ADR-0073 §3).
 *
 * @param previousStartsAt {@link Kind#RESCHEDULED}에만 값이 있다. "언제에서 언제로"가 없으면 변경
 *                         알림은 쓸모가 없다.
 * @param nextStartsAt     예정·변경의 새 시각. 취소에는 없다.
 */
public record LiveScheduleEvent(
        Kind kind,
        UUID sessionId,
        UUID lessonId,
        UUID curriculumId,
        OffsetDateTime previousStartsAt,
        OffsetDateTime nextStartsAt,
        OffsetDateTime occurredAt
) {

    public enum Kind {
        /** 처음 일정이 잡혔다. 시각 없이 만든 초안(DRAFT)에는 나지 않는다 — 알릴 일정이 없다. */
        SCHEDULED,
        /** 시각이 <b>실제로</b> 바뀌었다. 같은 시각으로 다시 저장한 것은 사건이 아니다. */
        RESCHEDULED,
        /** 취소됐다. 이미 취소된 것을 다시 취소한 멱등 호출에는 나지 않는다. */
        CANCELED
    }
}

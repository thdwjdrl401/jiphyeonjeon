package com.liveclass.support;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/**
 * 테스트용 라이브 일정 시각. <b>절대 시각 리터럴을 쓰지 않기 위한 지점이다.</b>
 *
 * <p>과거에 {@code "2026-08-01T10:00:00+09:00"} 같은 리터럴을 그대로 박아 세션을 만들었는데,
 * "예정" 판정이 {@code LiveSessionRepository.findUpcomingByCurriculumIds}의
 * {@code scheduledAt >= :now}라서 <b>그 시각이 지나는 순간</b> 세션이 집계에서 빠졌다. 그래서
 * {@code InstructorAuthoringReadContractTest}가 2026-08-01 10시(KST)를 넘기며 터졌고,
 * 머지 게이트가 CI 통과를 요구하므로 backend를 건드리는 모든 MR이 막혔다(시한폭탄).
 *
 * <p>리터럴은 "지금"과의 관계가 시간이 지나면 뒤집힌다. 예정 세션은 <b>미래</b>라는 성질이 본질이므로
 * 항상 현재 기준 상대값으로 만든다. 일정 시각 자체를 단언하는 테스트는 없다(존재·상태만 본다).
 */
public final class TestSchedules {

    private TestSchedules() {
    }

    /** 항상 미래인 라이브 예정 시각(ISO-8601 offset). 하루 뒤라 자정 경계·CI 지연에도 뒤집히지 않는다. */
    public static String futureScheduledAt() {
        return OffsetDateTime.now()
                .plusDays(1)
                .truncatedTo(ChronoUnit.SECONDS)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    /** 항상 미래인 라이브 예정 시각을 담은 세션 생성 요청 body. */
    public static String futureScheduledAtBody() {
        return "{\"scheduledAt\":\"" + futureScheduledAt() + "\"}";
    }
}

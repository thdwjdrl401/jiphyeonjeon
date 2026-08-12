package com.liveclass.learning.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 방금 다시보기를 보고 있던 사람 하나. learning이 밖으로 공개하는 경계 DTO다.
 *
 * <p><b>이름이 없다.</b> 여기서 아는 것은 id뿐이고 표시 이름은 auth가 안다 — 부르는 쪽이 붙인다.
 *
 * @param lastPositionMs 마지막으로 보고된 재생 위치. 진도를 보내지 않는 구간(길이를 모르는 라이브)에서는
 *                       올라가지 않으므로 0일 수 있다
 * @param progressPercent 서버가 계산한 진도율 0~100
 * @param lastReportedAt 마지막 시청 보고가 <b>서버에 닿은</b> 시각. 클라이언트가 보낸 시각이 아니다 —
 *                       기기 시계가 틀어져 있어도 이 값은 흔들리지 않는다
 */
public record RecentWatcherView(
        UUID userId,
        long lastPositionMs,
        int progressPercent,
        OffsetDateTime lastReportedAt) {
}

package com.liveclass.live.web.ws;

import java.time.OffsetDateTime;

/**
 * 강의 노트 WebSocket payload. 조회 응답과 <b>같은 모양</b>이다 — 새로고침으로 받은 것과 실시간으로
 * 받은 것이 다르면 화면이 두 경로를 따로 다뤄야 한다.
 *
 * <p>증분이 아니라 늘 전체다. 조각 이어 붙이기는 서버가 한 번만 한다.
 */
public record LectureNotePayload(
        long coveredThroughSequence,
        String topics,
        String markdown,
        String status,
        OffsetDateTime updatedAt
) {
}

package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 강의 노트의 현재 전체(CONTRACT §3-4a). 조회와 WebSocket 전파가 <b>같은 모양</b>을 쓴다.
 *
 * <p>증분이 아니라 늘 전체를 준다. 화면이 조각을 이어 붙이는 로직을 갖지 않게 하기 위해서다 —
 * 이어 붙이기는 서버가 한 번만 하고, 그 결과가 새로고침·재연결·실시간에서 모두 같아야 한다.
 *
 * @param coveredThroughSequence 이 노트가 반영한 자막 진행도. 수신 측이 오래된 것을 버리는 기준.
 * @param topics                 {@code [{topicId, title, keyPoints[]}]} JSON 배열 문자열(서버는 해석하지 않는다)
 * @param status                 {@code CAPTURING|COMPLETED|REFINED}
 */
public record LiveLectureNoteView(
        UUID sessionId,
        long coveredThroughSequence,
        String topics,
        String markdown,
        String status,
        OffsetDateTime updatedAt
) {

    /** 아직 노트가 없는 세션. "비어 있음"과 "없음"을 화면이 구분할 필요가 없어 빈 노트로 준다. */
    public static LiveLectureNoteView empty(UUID sessionId) {
        return new LiveLectureNoteView(sessionId, 0L, "[]", "", "CAPTURING", null);
    }
}

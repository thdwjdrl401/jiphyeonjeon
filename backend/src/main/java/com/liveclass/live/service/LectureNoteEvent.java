package com.liveclass.live.service;

import java.util.UUID;

/**
 * ai-api가 보내는 강의 노트 이벤트(CONTRACT §3-4a)를 타입으로 옮긴 것.
 *
 * <p>Redis에 의존하지 않는다 — 필드 맵을 이 타입으로 옮기는 일과, 이 타입을 노트에 반영하는 일을
 * 나눠 두면 누적·갭·멱등 규칙을 Redis 없이 시험할 수 있다.
 */
public sealed interface LectureNoteEvent {

    String eventId();

    UUID sessionId();

    UUID lessonId();

    /**
     * 라이브 중 새로 만들어진 노트 조각.
     *
     * @param chunkSequence     1부터 증가하는 조각 번호. 기대값보다 크면 중간이 빠진 것이다.
     * @param latestSttSequence 이 조각이 반영한 자막 진행도(조각 번호와 다른 축)
     * @param topicAction       {@code START_NEW}(새 주제 시작) 또는 {@code CONTINUE}(직전 주제에 요점 추가)
     * @param topicId           세션 안에서 topic을 식별하는 opaque 값. 서버는 형식을 해석하지 않는다
     * @param keyPoints         요점 배열의 JSON 문자열. 서버는 내용을 해석하지 않는다
     */
    record ChunkAppended(
            String eventId,
            UUID sessionId,
            UUID lessonId,
            long chunkSequence,
            long latestSttSequence,
            String topicAction,
            String topicId,
            String topicTitle,
            String keyPoints,
            String markdownFragment
    ) implements LectureNoteEvent {

        public boolean startsNewTopic() {
            return "START_NEW".equals(topicAction);
        }
    }

    /**
     * 이 세션의 자막 수집이 끝났다는 신호.
     *
     * @param lastChunkSequence 마지막으로 발행한 조각 번호. 조각이 없으면 0
     */
    record CaptureCompleted(
            String eventId,
            UUID sessionId,
            UUID lessonId,
            long lastChunkSequence,
            long lastSttSequence,
            String reason
    ) implements LectureNoteEvent {
    }

    /**
     * 수집 완료 뒤 한 번 정제한 전체 snapshot. live 노트에 <b>덧붙이는 값이 아니라 교체하는 값</b>이다.
     *
     * @param sourceLastChunkSequence 정제 입력이 된 마지막 조각 번호. 지금 반영한 순번과 같아야 반영한다
     */
    record RefinedSnapshot(
            String eventId,
            UUID sessionId,
            UUID lessonId,
            long sourceLastChunkSequence,
            String topics,
            String markdownSnapshot
    ) implements LectureNoteEvent {
    }
}

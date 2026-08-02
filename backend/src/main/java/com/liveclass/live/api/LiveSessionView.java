package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/** live 모듈이 공개하는 라이브 세션 표현. 관리·조회 응답으로도 쓴다. */
public record LiveSessionView(

        UUID sessionId,
        UUID lessonId,
        UUID instructorId,
        String liveSessionStatus,
        OffsetDateTime scheduledAt,
        Integer entryWindowMinutes,
        Integer expectedDurationMinutes,
        String roomSid,
        OffsetDateTime startedAt,
        OffsetDateTime endedAt,
        boolean recordingEnabled,
        boolean captionEnabled,
        boolean chatEnabled,
        boolean aiQnaEnabled,
        /**
         * 판서를 수강생 화면에 표시 중인가(ADR-0056). 강사가 새로고침해도 <b>이전 표시 상태로</b>
         * 돌아오게 하는 값이다 — 없으면 강사 화면은 비었는데 수강생 화면에만 판서가 남는다.
         */
        boolean annotationVisible,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,

        /**
         * 지금 강의실에 있는 <b>수강생</b> 수(ADR-0060). 강사는 세지 않는다.
         *
         * <p>세션 자체의 속성이 아니라 <b>조회 시점의 접속 현황</b>이라 DB에 없다. 조회 응답에만 채우고
         * 그 밖의 경로(생성·시작·종료 응답 등)는 0으로 둔다 — 그 응답들은 접속 현황을 말하지 않는다.
         *
         * <p>초기값을 여기서 주는 이유는 WebSocket만으로는 <b>본인이 방금 들어온 순간</b>의 인원을 알 수
         * 없기 때문이다. 구독이 브로커에 등록되기 전에 브로드캐스트가 나가 자기 것을 놓친다.
         */
        int participantCount
) {

    /** 조회 응답에 접속 현황을 얹는다. 세션 자체는 바뀌지 않는다. */
    public LiveSessionView withParticipantCount(int count) {
        return new LiveSessionView(sessionId, lessonId, instructorId, liveSessionStatus, scheduledAt,
                entryWindowMinutes, expectedDurationMinutes, roomSid, startedAt, endedAt,
                recordingEnabled, captionEnabled, chatEnabled, aiQnaEnabled, annotationVisible,
                createdAt, updatedAt, count);
    }
}

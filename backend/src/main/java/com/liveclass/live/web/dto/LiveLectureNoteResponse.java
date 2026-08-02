package com.liveclass.live.web.dto;

import com.liveclass.live.api.LiveLectureNoteView;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 강의 노트 조회 응답(CONTRACT §3-4a). WebSocket payload와 <b>같은 필드</b>다 — 새로고침으로 받은 것과
 * 실시간으로 받은 것이 다르면 화면이 두 경로를 따로 다뤄야 한다.
 */
@Schema(description = "라이브 강의 노트의 현재 전체. 증분이 아니라 늘 전체를 준다.")
public record LiveLectureNoteResponse(

        String sessionId,

        @Schema(description = "이 노트가 반영한 자막 진행도. 수신 측이 오래된 것을 버리는 기준.", example = "21")
        long coveredThroughSequence,

        @Schema(description = "[{topicId, title, keyPoints[]}] JSON 배열 문자열. 서버는 해석하지 않는다.")
        String topics,

        @Schema(description = "같은 내용의 Markdown. AI가 만들어 준 값을 그대로 옮긴다.")
        String markdown,

        @Schema(description = "CAPTURING(자라는 중)·COMPLETED(자막 수집 종료)·REFINED(정제본으로 교체됨)",
                example = "CAPTURING")
        String status,

        @Schema(description = "아직 노트가 없으면 null.")
        OffsetDateTime updatedAt) {

    public static LiveLectureNoteResponse from(LiveLectureNoteView view) {
        return new LiveLectureNoteResponse(view.sessionId().toString(), view.coveredThroughSequence(),
                view.topics(), view.markdown(), view.status(), view.updatedAt());
    }
}

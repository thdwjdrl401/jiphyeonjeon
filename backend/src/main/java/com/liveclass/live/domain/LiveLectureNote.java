package com.liveclass.live.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 강의 노트 read model(CONTRACT §3-4a). 세션당 한 행이다.
 *
 * <p><b>결과만 담는다.</b> ai-api가 노트를 증분 조각으로 보내든 전체 스냅샷으로 보내든, 화면이
 * 필요로 하는 것은 "지금까지의 노트 전체" 하나뿐이다. 그 결과만 여기 두면 producer의 발행 방식이
 * 바뀌어도 조회·전파 계약과 저장 모델은 그대로다.
 *
 * <p><b>본문을 해석하지 않는다.</b> {@code topics}는 JSON 문자열 그대로 옮긴다 — AI가 항목을 늘릴
 * 때마다 서버 마이그레이션이 따라오지 않게 하기 위해서다(판서 §3-6d와 같은 이유).
 */
@Entity
@Table(schema = "core", name = "live_lecture_note")
@Getter
@Setter
@NoArgsConstructor
public class LiveLectureNote {

    @Id
    private UUID sessionId;

    private UUID lessonId;

    /**
     * 이 노트가 반영한 자막 진행도. 뒤늦게 도착한 옛 노트가 최신 노트를 덮지 않게 하는 기준이다 —
     * 이 값보다 크지 않은 갱신은 무시한다.
     */
    private long coveredThroughSequence;

    /**
     * 마지막으로 반영한 조각 번호. {@code coveredThroughSequence}(자막 진행도)와 <b>다른 축</b>이다 —
     * 그쪽은 "어디까지 들었나", 이건 "몇 번째 조각까지 반영했나"다. 갭 판정과 {@code capture.completed}
     * 검증이 이 값을 쓴다.
     */
    private long lastChunkSequence;

    /** {@code [{topicId, title, keyPoints[]}]} JSON 배열 문자열. 서버는 해석하지 않는다. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String topics;

    /** 같은 내용의 Markdown 표현. AI가 결정론적으로 만들어 주므로 서버가 다시 만들지 않는다. */
    private String markdown;

    /** {@code CAPTURING}(자라는 중) · {@code COMPLETED}(자막 수집 종료) · {@code REFINED}(정제본으로 교체됨). */
    private String status;

    private OffsetDateTime updatedAt;
}

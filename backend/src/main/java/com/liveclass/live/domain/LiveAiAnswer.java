package com.liveclass.live.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
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
 * 라이브 AI 질의응답 한 건(ADR-0047 확장).
 *
 * <p><b>개인 것이다.</b> 채팅과 달리 질문자 본인에게만 보인다 — 남의 질문이 보이면 "무엇을 모르는지"가
 * 드러난다. 조회는 반드시 {@code userId}까지 조건에 넣는다.
 *
 * <p>스트림이 끝날 때 한 번 쓴다. delta마다 쓰면 한 답변에 수십 번 UPDATE가 나가는데, 진행 중 텍스트는
 * 이미 SSE로 흐르고 있어 그 비용이 화면에 주는 값이 없다.
 */
@Entity
@Table(schema = "core", name = "live_ai_answer")
@Getter
@Setter
@NoArgsConstructor
public class LiveAiAnswer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 서버가 채번한 요청 식별자. 같은 스트림을 두 번 저장하지 않게 하는 멱등키. */
    private String requestId;

    private UUID sessionId;
    private UUID lessonId;
    private UUID userId;

    private String question;

    /** delta를 이어 붙인 최종 답변. 실패로 끝났으면 그때까지 받은 부분까지만 남는다. */
    private String answer;

    /** 근거 목록(JSON 배열 문자열). 서버는 해석하지 않는다. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String sources;

    /** {@code DONE} · {@code INSUFFICIENT} · {@code ERROR}. */
    private String status;

    /** {@code status=ERROR}일 때의 안정적인 code. 아니면 null. */
    private String failureCode;

    private OffsetDateTime askedAt;
}

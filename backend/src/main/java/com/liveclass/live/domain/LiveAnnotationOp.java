package com.liveclass.live.domain;

import jakarta.persistence.Column;
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
 * 강사 판서 op append-only 로그(ADR-0051, CONTRACT §3-6b).
 *
 * <p><b>라이브 전달과 저장은 다른 경로다.</b> 수강생에게 판서가 도달하는 경로는 LiveKit 데이터 채널
 * → Egress 합성 프레임이며, 이 테이블은 그 경로와 무관하게 기록만 남긴다. 저장이 실패해도 강사 화면과
 * 수강생 화면은 계속 간다 — 저장을 라이브 경로에 넣으면 획을 그을 때마다 HTTP를 타게 되어 그리는
 * 동안의 부드러움이 깨진다.
 *
 * <p><b>왜 "마지막 상태"가 아니라 op 로그인가.</b> 두 가지를 동시에 얻기 위해서다.
 * <ol>
 *   <li>강사가 새로고침해도 op를 접어 문서를 복원한다.</li>
 *   <li>각 op에 세션 상대 시각이 붙어 "강사가 이걸 강조한 순간"으로 다시보기를 이동할 수 있다
 *       (자막이 쓰는 축과 동일, ADR-0045). 마지막 상태만 저장하면 이 시간축이 사라진다.</li>
 * </ol>
 */
@Entity
@Table(schema = "core", name = "live_annotation_op")
@Getter
@Setter
@NoArgsConstructor
public class LiveAnnotationOp {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID sessionId;

    /**
     * 세션 안에서 단조 증가하는 op 번호. 강사가 채번하며 {@code (sessionId, revision)}이 UNIQUE라
     * 재전송이 중복 적재되지 않는다.
     */
    private long revision;

    /** snapshot · upsert · delete · clear. */
    private String opType;

    /**
     * op 본문(camelCase JSON). Excalidraw 요소를 그대로 담는다.
     *
     * <p>스키마를 컬럼으로 펴지 않는 이유: 요소 구조는 Excalidraw가 정하고 버전마다 바뀐다. 우리는
     * 그 안을 해석하지 않고 <b>그대로 되돌려주는 것</b>이 일이므로, 펴 두면 업그레이드마다 마이그레이션이
     * 따라온다.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String payload;

    /**
     * 세션 상대 ms(근사). 다시보기에서 강조 시점으로 이동하는 앵커다. {@code clockOriginAt}이 아직
     * 없으면 null이다(ADR-0045와 같은 축·같은 한계).
     */
    private Long sessionMs;

    /** 강사 브라우저가 op를 만든 시각. */
    private OffsetDateTime occurredAt;

    /** 서버가 적재한 시각. */
    private OffsetDateTime receivedAt;
}

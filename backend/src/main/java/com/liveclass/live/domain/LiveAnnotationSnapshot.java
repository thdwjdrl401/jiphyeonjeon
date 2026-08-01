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
 * 판서 복원 체크포인트(ADR-0057).
 *
 * <p><b>op가 아니다.</b> ADR-0055 이후 스냅샷은 전송 메시지가 아니므로 op 스트림 밖에 둔다. op
 * 테이블에 넣으면 revision이 문제가 된다 — 이미 쓴 번호는 UNIQUE에 걸리고, 새 번호를 소비하면
 * 그것이 데이터 채널로 나가지 않아 수신 측에서 <b>번호 구멍</b>이 되어 그 뒤 op가 전부 버려진다.
 *
 * <p>세션당 한 행이다. 새 체크포인트가 오면 덮어쓴다 — 복원은 언제나 가장 최근 것에서 시작한다.
 */
@Entity
@Table(schema = "core", name = "live_annotation_snapshot")
@Getter
@Setter
@NoArgsConstructor
public class LiveAnnotationSnapshot {

    @Id
    private UUID sessionId;

    /** 이 체크포인트가 반영한 마지막 op 번호. 복원은 이보다 큰 op만 얹는다. */
    private long revision;

    /** 문서 본문(JSON 문자열). 서버는 해석하지 않는다 — §3-6d의 전제다. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String payload;

    private OffsetDateTime updatedAt;
}

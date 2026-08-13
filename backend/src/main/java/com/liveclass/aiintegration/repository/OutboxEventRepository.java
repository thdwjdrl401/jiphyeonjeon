package com.liveclass.aiintegration.repository;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);

    /**
     * 지금 보낼 것이 있는 <b>목적지들</b>. 릴레이가 목적지마다 따로 배치를 뽑기 위한 첫 단계다.
     *
     * <p>목적지 수는 큐 종류만큼(현재 둘)이라 이 조회 자체는 늘 작다.
     */
    @Query("""
            SELECT DISTINCT e.destination FROM OutboxEvent e
            WHERE e.status = :status AND e.nextAttemptAt <= :cutoff
            """)
    List<String> findPendingDestinations(@Param("status") OutboxStatus status,
                                         @Param("cutoff") OffsetDateTime cutoff);

    /**
     * 릴레이 발행 대상: 한 <b>목적지</b>의 PENDING을 오래된 순으로 최대 100건 <b>집어 잠근다</b>.
     *
     * <p>목적지를 조건에 넣은 것이 첫 번째 이유다. 전체에서 100건을 뽑으면 알림이 1,000건 쌓였을 때
     * 자료 임베딩 잡이 뒤로 밀려 <b>업로드하고 한참 뒤에야</b> 임베딩이 시작된다(머리 막힘, ADR-0073 §4).
     *
     * <p><b>{@code FOR UPDATE SKIP LOCKED}가 두 번째다.</b> 커밋 뒤 릴레이를 깨우는 트리거가 생기면서
     * (ADR-0122) 스케줄러 틱과 트리거가 <b>같은 순간에</b> 이 배치를 뽑을 수 있게 됐다. 잠금이 없으면
     * 둘이 같은 행을 집어 같은 메시지를 브로커에 두 번 싣는다. 그냥 {@code FOR UPDATE}면 뒤에 온 쪽이
     * 앞선 쪽의 커밋까지 <b>블로킹</b>되므로, 잠긴 행은 건너뛰고 <b>남은 행부터</b> 가져가게 한다.
     * 인스턴스를 늘려도 같은 장치가 그대로 지킨다.
     *
     * <p>잠금 절은 메서드 이름으로 표현할 수 없어 네이티브로 내렸다. 그래서 상한 100도 이제 이름이
     * 아니라 SQL이 들고 있다 — 이름만 보고 상한을 알 수 없으니 여기 적어 둔다.
     *
     * <p>{@code status}를 문자열로 받는 것은 네이티브 쿼리라서다. 열거형을 그대로 넘기면 바인딩이
     * 이름이 아니라 순서값으로 갈 수 있어 조건이 조용히 빗나간다.
     */
    @Query(value = """
            SELECT * FROM core.outbox_events
             WHERE status = :status AND destination = :destination AND next_attempt_at <= :cutoff
             ORDER BY created_at
             LIMIT 100
             FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<OutboxEvent> lockPendingBatchForDestination(@Param("status") String status,
                                                     @Param("destination") String destination,
                                                     @Param("cutoff") OffsetDateTime cutoff);

    /**
     * 발행에 성공한 행들을 <b>한 문장으로</b> PUBLISHED로 넘긴다.
     *
     * <p>전에는 엔티티 필드를 고쳐 더티 체킹에 맡겼는데, 그러면 100건 배치가 {@code UPDATE} 100번이
     * 된다. {@code hibernate.jdbc.batch_size}로 묶는 길도 있지만 그건 이 애플리케이션의 <b>모든</b>
     * 쓰기에 영향을 주는 전역 설정이라 아웃박스 하나 때문에 켤 결정이 아니다.
     *
     * <p>실패분은 여기 오지 않는다 — 행마다 {@code attempt_count}·{@code next_attempt_at}·
     * {@code last_error}가 다르므로 한 문장으로 묶이지 않는다. 실패는 드무니 개별 UPDATE로 둔다.
     *
     * <p><b>{@code clearAutomatically}가 핵심이다.</b> 네이티브 UPDATE는 영속성 컨텍스트를 지나치므로,
     * 방금 읽어 둔 {@link OutboxEvent}들은 여전히 PENDING이라고 믿는다. 그 상태로 같은 트랜잭션에서
     * 다시 조회하면 Hibernate가 DB 행이 아니라 <b>손에 든 옛 인스턴스</b>를 돌려준다. 그래서 실행 뒤
     * 컨텍스트를 비워 다음 조회가 DB를 다시 읽게 한다. {@code flushAutomatically}는 그 비우기가
     * <b>실패분의 아직 안 나간 변경까지 버리지 않도록</b> 먼저 내보내기 위한 것이다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE core.outbox_events
               SET status = 'PUBLISHED', published_at = now()
             WHERE id = ANY(:ids)
            """, nativeQuery = true)
    int markPublished(@Param("ids") Long[] ids);
}

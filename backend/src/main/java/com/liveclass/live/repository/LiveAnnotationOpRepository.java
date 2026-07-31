package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveAnnotationOp;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LiveAnnotationOpRepository extends JpaRepository<LiveAnnotationOp, Long> {

    /** 재전송 멱등 확인. `(sessionId, revision)`이 UNIQUE라 중복 적재는 DB도 막지만, 먼저 걸러 낸다. */
    boolean existsBySessionIdAndRevision(UUID sessionId, long revision);

    /**
     * 강사가 이어서 채번할 시작점. 새로고침하면 강사의 카운터가 0으로 돌아가는데, 이 값을 받아
     * 이어가면 revision이 역행하지 않는다(역행하면 수신 측이 새 op를 "이미 본 op"로 버린다).
     */
    @Query("select coalesce(max(o.revision), 0) from LiveAnnotationOp o where o.sessionId = :sessionId")
    long findMaxRevision(@Param("sessionId") UUID sessionId);

    /**
     * 문서 복원의 시작점 — <b>마지막 snapshot</b>. 세션 전체를 접으면 강의가 길어질수록 느려지므로,
     * 스냅샷 이후 op만 접는다.
     */
    Optional<LiveAnnotationOp> findFirstBySessionIdAndOpTypeOrderByRevisionDesc(UUID sessionId, String opType);

    /** 주어진 revision <b>이후</b>의 op를 순서대로. 문서를 접는 데 쓴다. */
    List<LiveAnnotationOp> findBySessionIdAndRevisionGreaterThanOrderByRevisionAsc(UUID sessionId, long revision);

    /** 세션의 적재 op 수(테스트·진단용). */
    long countBySessionId(UUID sessionId);
}

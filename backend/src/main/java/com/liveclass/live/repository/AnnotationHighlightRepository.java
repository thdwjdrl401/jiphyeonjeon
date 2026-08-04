package com.liveclass.live.repository;

import com.liveclass.live.domain.AnnotationHighlight;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;

import java.util.List;
import java.util.UUID;

public interface AnnotationHighlightRepository extends JpaRepository<AnnotationHighlight, UUID> {

    /** 강조 내역: 세션 하나의 살아 있는 스냅샷을 시각순으로. 뺀 것(removedAt)은 담지 않는다. */
    List<AnnotationHighlight> findByLiveSessionIdAndRemovedAtIsNullOrderBySessionMsAsc(UUID liveSessionId);

    /**
     * 설명 워커가 집어 갈 것들. 뺀 것은 처리하지 않는다 — 근거에서 뺐는데 모델을 부를 이유가 없다.
     *
     * <p>{@code nextAttemptAt}이 null이면 아직 한 번도 시도하지 않은 것이고, 값이 있으면 백오프가
     * 끝났는지 본다. 오래 기다린 것부터 처리한다.
     */
    @Query("select h from AnnotationHighlight h where h.indexStatus = :status and h.removedAt is null"
            + " and (h.nextAttemptAt is null or h.nextAttemptAt <= :now) order by h.createdAt asc")
    List<AnnotationHighlight> findDescribable(@Param("status") String status,
                                              @Param("now") OffsetDateTime now,
                                              Limit limit);
}

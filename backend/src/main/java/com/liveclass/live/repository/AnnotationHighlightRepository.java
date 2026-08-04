package com.liveclass.live.repository;

import com.liveclass.live.domain.AnnotationHighlight;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AnnotationHighlightRepository extends JpaRepository<AnnotationHighlight, UUID> {

    /** 강조 내역: 세션 하나의 살아 있는 스냅샷을 시각순으로. 뺀 것(removedAt)은 담지 않는다. */
    List<AnnotationHighlight> findByLiveSessionIdAndRemovedAtIsNullOrderBySessionMsAsc(UUID liveSessionId);
}

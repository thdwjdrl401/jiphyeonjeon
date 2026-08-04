package com.liveclass.live.repository;

import com.liveclass.live.domain.AnnotationHighlight;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AnnotationHighlightRepository extends JpaRepository<AnnotationHighlight, UUID> {

    /** 강조 내역: 세션 하나의 살아 있는 스냅샷을 시각순으로. 뺀 것(removedAt)은 담지 않는다. */
    List<AnnotationHighlight> findByLiveSessionIdAndRemovedAtIsNullOrderBySessionMsAsc(UUID liveSessionId);

    /** 설명 워커가 집어 갈 것들. 뺀 것은 처리하지 않는다 — 근거에서 뺐는데 모델을 부를 이유가 없다. */
    List<AnnotationHighlight> findByIndexStatusAndRemovedAtIsNullOrderByCreatedAtAsc(String indexStatus, Limit limit);
}

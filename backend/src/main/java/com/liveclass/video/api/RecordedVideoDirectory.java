package com.liveclass.video.api;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 업로드 녹화강의 공개 상태를 다른 모듈에 엔티티 없이 제공하는 조회 포트. */
public interface RecordedVideoDirectory {

    List<RecordedDeliveryView> findByLessons(Collection<UUID> lessonIds);

    Optional<RecordedDeliveryView> findByLesson(UUID lessonId);
}

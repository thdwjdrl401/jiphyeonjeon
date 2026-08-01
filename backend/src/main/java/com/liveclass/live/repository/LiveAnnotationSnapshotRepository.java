package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveAnnotationSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/** 판서 복원 체크포인트 저장소(ADR-0057). 세션당 한 행. */
public interface LiveAnnotationSnapshotRepository extends JpaRepository<LiveAnnotationSnapshot, UUID> {
}

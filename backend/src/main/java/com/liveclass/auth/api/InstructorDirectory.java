package com.liveclass.auth.api;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 강사 요약 조회 포트. 다른 모듈은 이 인터페이스로만 강사 정보를 얻고,
 * auth의 엔티티·리포지토리에는 접근하지 않는다(모듈 경계, AGENTS.md).
 */
public interface InstructorDirectory {

    /** 주어진 강사 ID들의 요약을 반환한다. 없는 ID는 결과에서 빠진다. */
    List<InstructorSummaryView> findSummaries(Collection<UUID> instructorIds);
}

package com.liveclass.curriculum.api;

import java.util.Optional;
import java.util.UUID;

/**
 * 커리큘럼 조회 포트. 다른 모듈은 이 인터페이스로만 커리큘럼을 읽고, curriculum의 엔티티·
 * 리포지토리에는 접근하지 않는다(모듈 경계, AGENTS.md).
 *
 * <p>알림의 대상 재판정이 첫 소비자다 — 알림을 누른 순간 그 커리큘럼이 아직 있는지, 누른 사람이
 * 주인인지 봐야 하는데, 그 답을 얻자고 커리큘럼 내부를 열 수는 없다.
 */
public interface CurriculumDirectory {

    /** 없으면 빈 값. 삭제된 커리큘럼과 처음부터 없던 id를 구별하지 않는다 — 부르는 쪽에 같은 뜻이다. */
    Optional<CurriculumView> findById(UUID curriculumId);
}

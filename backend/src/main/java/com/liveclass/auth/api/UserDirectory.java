package com.liveclass.auth.api;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 사용자 조회 포트. 다른 모듈은 이걸로만 사용자 정보를 얻는다(auth 엔티티·리포지토리 비접근). */
public interface UserDirectory {

    Optional<UserView> findById(UUID userId);

    /** PII(이메일) 배치 조회 — 강사 로스터 등 이메일이 필요한 경로 전용. N+1 없이 목록을 한 번에 보강한다. */
    List<UserContact> findContacts(Collection<UUID> userIds);
}

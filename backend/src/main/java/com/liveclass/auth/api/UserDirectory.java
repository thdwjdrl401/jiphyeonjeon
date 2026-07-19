package com.liveclass.auth.api;

import java.util.Optional;
import java.util.UUID;

/** 사용자 조회 포트. 다른 모듈은 이걸로만 사용자 정보를 얻는다(auth 엔티티·리포지토리 비접근). */
public interface UserDirectory {

    Optional<UserView> findById(UUID userId);
}

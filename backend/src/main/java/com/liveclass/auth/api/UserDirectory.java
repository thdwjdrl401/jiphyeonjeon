package com.liveclass.auth.api;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** 사용자 조회 포트. 다른 모듈은 이걸로만 사용자 정보를 얻는다(auth 엔티티·리포지토리 비접근). */
public interface UserDirectory {

    Optional<UserView> findById(UUID userId);

    /** PII(이메일) 배치 조회 — 강사 로스터 등 이메일이 필요한 경로 전용. N+1 없이 목록을 한 번에 보강한다. */
    List<UserContact> findContacts(Collection<UUID> userIds);

    /**
     * userId → 프로필 이미지 URL 배치 해석. 사진을 올리지 않았거나 에셋이 아직 UPLOADED가 아니면
     * 결과에서 빠진다(없는 것과 같게 다룬다).
     *
     * <p><b>익명 발신자를 여기 넣지 않는 것은 호출자의 책임이다.</b> 이 포트는 "이 사용자의 사진"만
     * 답하고 익명 여부를 모른다 — 채팅에서는 {@code ChatMessageResponse}·{@code ChatService}가 익명이면
     * 애초에 묻지 않는다(ADR-0050).
     */
    Map<UUID, String> findAvatarUrls(Collection<UUID> userIds);
}

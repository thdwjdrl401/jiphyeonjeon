package com.liveclass.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(schema = "core", name = "app_user")
@Getter
@Setter
@NoArgsConstructor
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private String email;

    private String passwordHash;

    private String displayName;

    @Enumerated(EnumType.STRING)
    private Role role;

    @Enumerated(EnumType.STRING)
    private AccountStatus status;

    private UUID profileImageAssetId;

    private OffsetDateTime withdrawnAt;

    private OffsetDateTime lastLoginAt;

    /**
     * 메일로 보낸 임시 비밀번호의 해시(V41). {@code passwordHash}와 <b>별개로</b> 산다.
     *
     * <p>덮어쓰지 않는 이유: 그러면 남이 내 이메일로 재발급을 누르기만 해도 내가 로그인에서 튕긴다 —
     * 메일함을 못 봐도 남의 계정을 잠글 수 있게 된다.
     */
    private String temporaryPasswordHash;

    /** 임시 비밀번호 만료 시각. 지나면 그 값으로는 로그인할 수 없다. */
    private OffsetDateTime temporaryPasswordExpiresAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}

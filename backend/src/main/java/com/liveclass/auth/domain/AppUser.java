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
     * 임시 비밀번호를 받고 아직 바꾸지 않았는가(V40).
     *
     * <p>임시 비밀번호는 평문으로 메일함에 남는다. 만료만 걸고 두면 그 메일이 살아 있는 한 계정도
     * 열려 있는 셈이라, 첫 로그인에서 반드시 바꾸게 한다.
     */
    private boolean mustChangePassword;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}

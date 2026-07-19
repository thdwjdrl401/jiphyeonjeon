package com.liveclass.auth.service;

import com.liveclass.auth.domain.AccountStatus;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import com.liveclass.auth.repository.AppUserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {

    private static final String CREDENTIALS_REJECTED = "이메일 또는 비밀번호를 확인해 주세요.";

    private final AppUserRepository appUserRepository;
    private final PasswordEncoder passwordEncoder;

    /**
     * 계정이 없을 때도 해싱 비용을 치르기 위한 미끼 해시.
     * 없으면 "모르는 이메일"이 "아는 이메일 + 틀린 비번"보다 10배 빨리 응답해
     * 응답 시간만으로 가입 여부를 알아낼 수 있다.
     */
    private final String decoyHash;

    public AuthService(AppUserRepository appUserRepository, PasswordEncoder passwordEncoder) {
        this.appUserRepository = appUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.decoyHash = passwordEncoder.encode("decoy-password-that-never-matches");
    }

    @Transactional
    public AppUser signup(String email, String rawPassword, String displayName, Role role) {
        String normalized = normalize(email);
        if (appUserRepository.existsByEmail(normalized)) {
            throw new EmailDuplicatedException("이미 사용 중인 이메일입니다.");
        }

        AppUser user = new AppUser();
        user.setEmail(normalized);
        user.setPasswordHash(passwordEncoder.encode(rawPassword));
        user.setDisplayName(displayName);
        user.setRole(role);
        // 이메일 인증 플로우 도입 전까지는 PENDING을 벗어날 경로가 없어 가입 즉시 ACTIVE.
        // 인증 도입 시 여기만 PENDING으로 되돌리면 authenticate()의 상태 검사가 그대로 게이트가 된다.
        user.setStatus(AccountStatus.ACTIVE);

        try {
            return appUserRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            // 동시 가입 경합에서는 위 존재 검사가 아니라 UNIQUE(email) 제약이 최종 판정자다.
            throw new EmailDuplicatedException("이미 사용 중인 이메일입니다.");
        }
    }

    @Transactional
    public AppUser authenticate(String email, String rawPassword) {
        AppUser user = appUserRepository.findByEmail(normalize(email)).orElse(null);
        if (user == null) {
            // 곧바로 거절하면 응답 시간이 계정 존재 여부를 알려준다 → 미끼 해시로 같은 비용을 치른다.
            passwordEncoder.matches(rawPassword, decoyHash);
            throw new InvalidCredentialsException(CREDENTIALS_REJECTED);
        }

        if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            throw new InvalidCredentialsException(CREDENTIALS_REJECTED);
        }
        if (user.getStatus() != AccountStatus.ACTIVE) {
            // 계정 상태를 응답으로 구분해주면 계정 존재 여부가 드러난다 → 자격 증명 실패와 같은 응답.
            throw new InvalidCredentialsException(CREDENTIALS_REJECTED);
        }

        user.setLastLoginAt(OffsetDateTime.now());
        return user;
    }

    @Transactional(readOnly = true)
    public boolean isEmailAvailable(String email) {
        return !appUserRepository.existsByEmail(normalize(email));
    }

    @Transactional(readOnly = true)
    public AppUser getById(UUID id) {
        return appUserRepository.findById(id)
                .orElseThrow(() -> new InvalidCredentialsException(CREDENTIALS_REJECTED));
    }

    private String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}

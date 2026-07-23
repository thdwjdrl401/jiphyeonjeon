package com.liveclass.auth.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.auth.domain.AccountStatus;
import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.common.logging.Audit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final String CREDENTIALS_REJECTED = "이메일 또는 비밀번호를 확인해 주세요.";

    private final AppUserRepository appUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final AssetDirectory assetDirectory;

    /**
     * 계정이 없을 때도 해싱 비용을 치르기 위한 미끼 해시.
     * 없으면 "모르는 이메일"이 "아는 이메일 + 틀린 비번"보다 10배 빨리 응답해
     * 응답 시간만으로 가입 여부를 알아낼 수 있다.
     */
    private final String decoyHash;

    public AuthService(AppUserRepository appUserRepository, PasswordEncoder passwordEncoder,
                       AssetDirectory assetDirectory) {
        this.appUserRepository = appUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.assetDirectory = assetDirectory;
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
            AppUser saved = appUserRepository.saveAndFlush(user);
            log.info(Audit.MARKER, "회원가입 userId={} role={}", saved.getId(), role);
            return saved;
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
        log.info(Audit.MARKER, "로그인 성공 userId={}", user.getId());
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

    /**
     * 프로필 이미지 지정. asset.api로 검증한다 — 본인이 올린, 종류 PROFILE_IMAGE, 완료(UPLOADED)
     * 여야 한다. asset 엔티티엔 직접 접근하지 않고 포트만 쓴다(모듈 경계).
     */
    @Transactional
    public AppUser updateProfileImage(UUID userId, UUID assetId) {
        AppUser user = appUserRepository.findById(userId)
                .orElseThrow(() -> new InvalidCredentialsException(CREDENTIALS_REJECTED));
        AssetRef ref = assetDirectory.find(assetId)
                .orElseThrow(() -> new ProfileImageInvalidException("프로필 이미지 에셋을 찾을 수 없습니다."));
        if (!userId.equals(ref.uploadedBy())
                || !"PROFILE_IMAGE".equals(ref.kind())
                || !"UPLOADED".equals(ref.status())) {
            throw new ProfileImageInvalidException("유효하지 않은 프로필 이미지 에셋입니다.");
        }
        user.setProfileImageAssetId(assetId);
        log.info(Audit.MARKER, "프로필 이미지 변경 userId={} assetId={}", userId, assetId);
        return user;
    }

    /**
     * 표시 이름 변경. 화면에 보이는 이름만 바꾼다 — 로그인 식별자(email)와 역할은 건드리지 않는다.
     * 중복을 막지 않는 이름이므로 유일성 검사도 없다.
     */
    @Transactional
    public AppUser updateDisplayName(UUID userId, String displayName) {
        AppUser user = appUserRepository.findById(userId)
                .orElseThrow(() -> new InvalidCredentialsException(CREDENTIALS_REJECTED));
        user.setDisplayName(displayName);
        log.info(Audit.MARKER, "표시 이름 변경 userId={}", userId);
        return user;
    }

    /** 사용자의 프로필 이미지 표시용 presigned URL(없거나 미완료면 null). */
    @Transactional(readOnly = true)
    public String resolveProfileImageUrl(AppUser user) {
        UUID assetId = user.getProfileImageAssetId();
        return assetId == null ? null : assetDirectory.resolveUrl(assetId).orElse(null);
    }

    private String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}

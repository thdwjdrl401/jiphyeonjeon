package com.liveclass.auth.web.dto;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "인증된 사용자")
public record AuthUserResponse(

        @Schema(description = "사용자 식별자(UUID)", example = "cac506e4-0d5b-4a2d-9a6f-025bf5c698e2")
        String userId,

        @Schema(description = "로그인 이메일", example = "student@liveclass.test")
        String email,

        @Schema(description = "화면 표시 이름", example = "김학생")
        String displayName,

        @Schema(description = "전역 역할", example = "STUDENT")
        Role role,

        @Schema(description = "표시용 프로필 이미지 URL. 미설정/미해결 시 null.")
        String profileImageUrl,

        @Schema(description = "운영 콘솔(ROLE_ADMIN) 접근 권한 여부. 가입 역할이 아니라 "
                + "security.admin-emails allowlist로 로그인 시 덧입혀지는 권한이다.", example = "false")
        boolean isAdmin,

        @Schema(description = "이번 로그인이 임시 비밀번호로 이루어졌는가. true면 화면이 비밀번호 "
                + "변경 외의 이동을 막는다. **계정이 아니라 이 세션의 성질이다** — 같은 계정이라도 "
                + "원래 비밀번호로 들어오면 false다.", example = "false")
        boolean signedInWithTemporaryPassword,

        @Schema(description = "지금 쓸 수 있는 임시 비밀번호가 발급돼 있는가. 원래 비밀번호로 "
                + "들어온 사람에게 '폐기하시겠습니까'를 묻는 데 쓴다.", example = "false")
        boolean temporaryPasswordActive
) {

    /**
     * {@code isAdmin}은 <b>화면 표시용</b>이다 — 관리 메뉴를 띄울지 결정하는 데 쓴다. 실제 인가는 언제나
     * 서버가 {@code /api/admin/**}에서 {@code ROLE_ADMIN}으로 판정하므로, 이 값을 위조해도 얻는 것은 없다.
     *
     * <p>기본값을 두지 않고 호출자가 명시하게 한다. 조용히 {@code false}로 흘려보내면 관리자인데 메뉴가
     * 안 보이는(=원인을 찾기 어려운) 상태가 만들어진다.
     */
    public static AuthUserResponse from(AppUser user, String profileImageUrl, boolean isAdmin,
                                        boolean signedInWithTemporaryPassword,
                                        boolean temporaryPasswordActive) {
        return new AuthUserResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole(),
                profileImageUrl,
                isAdmin,
                signedInWithTemporaryPassword,
                temporaryPasswordActive
        );
    }
}

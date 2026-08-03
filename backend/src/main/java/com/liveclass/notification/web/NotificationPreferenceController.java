package com.liveclass.notification.web;

import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.service.NotificationPreferenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 곧 시작 알림 설정(CONTRACT §2-4, ADR-0073 4단계).
 *
 * <p><b>강사·학생을 가르지 않는다.</b> 둘 다 자기 알림 설정을 갖고, 경로도 같다 — 역할로 나누면
 * 같은 화면을 두 벌 만들게 되고 강사가 학생으로 수강할 때 설정이 갈라진다.
 */
@Tag(name = "알림 설정", description = "라이브 곧 시작 알림의 리드타임. 커리큘럼 단위이고 강의별로 덮어쓴다.")
@RestController
public class NotificationPreferenceController {

    private final NotificationPreferenceService preferenceService;

    public NotificationPreferenceController(NotificationPreferenceService preferenceService) {
        this.preferenceService = preferenceService;
    }

    @Operation(summary = "고를 수 있는 리드타임",
            description = "자유 입력이 아니다 — 예약 표가 이 선택지에 맞춰 미리 만들어져 있다.")
    @GetMapping("/api/me/notification-preferences/lead-times")
    public LeadTimesResponse leadTimes() {
        return new LeadTimesResponse(NotificationLeadTimes.CHOICES, NotificationLeadTimes.DEFAULT_MINUTES);
    }

    @Operation(summary = "지금 적용되는 설정",
            description = "강의 → 커리큘럼 → 기본값 순으로 찾은 결과와 어디서 왔는지를 함께 준다.")
    @GetMapping("/api/me/notification-preferences")
    public EffectiveResponse effective(@RequestParam UUID curriculumId,
                                       @RequestParam(required = false) UUID lessonId,
                                       Authentication authentication) {
        var effective = preferenceService.effective(
                UUID.fromString(authentication.getName()), curriculumId, lessonId);
        return new EffectiveResponse(effective.enabled(), effective.leadMinutes(), effective.source());
    }

    @Operation(summary = "설정 저장",
            description = "lessonId를 주면 그 강의만 덮어쓰고, 없으면 커리큘럼 전체에 적용한다.")
    @PutMapping("/api/me/notification-preferences")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void save(@Valid @RequestBody SaveRequest request, Authentication authentication) {
        preferenceService.save(UUID.fromString(authentication.getName()),
                request.curriculumId(), request.lessonId(), request.enabled(), request.leadMinutes());
    }

    public record LeadTimesResponse(List<Integer> choices, int defaultMinutes) {
    }

    public record EffectiveResponse(boolean enabled, int leadMinutes, String source) {
    }

    public record SaveRequest(
            @NotNull UUID curriculumId,
            UUID lessonId,
            boolean enabled,
            @NotNull Integer leadMinutes) {
    }
}

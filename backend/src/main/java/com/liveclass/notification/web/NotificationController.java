package com.liveclass.notification.web;

import com.liveclass.notification.domain.Notification;
import com.liveclass.notification.service.NotificationPage;
import com.liveclass.notification.service.NotificationService;
import com.liveclass.notification.web.dto.NotificationPageResponse;
import com.liveclass.notification.web.dto.NotificationResponse;
import com.liveclass.notification.web.dto.NotificationSummaryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.UUID;

/**
 * 내 알림(CONTRACT §2-4). 인증은 SecurityConfig의 {@code anyRequest().authenticated()}로 걸린다.
 *
 * <p><b>소유권을 따로 확인하지 않는다.</b> 모든 경로가 로그인한 사람의 id를 조건으로 넘기므로
 * 남의 알림은 조회되지도 갱신되지도 않는다 — 그대로 404다. 403을 주면 "그 알림이 존재한다"는
 * 사실이 새기 때문에 계약이 404를 요구한다.
 *
 * <p>{@code GET /{id}/target}(대상 재판정)은 2단계다. 다섯 경로 중 그것만 다른 모듈 넷을 읽어야
 * 하는데, 지금은 발행 지점이 없어 클릭할 알림 자체가 없다.
 */
@Tag(name = "알림", description = "내 알림 목록·배지·읽음 처리. 본인 것만 보인다.")
@RestController
@Validated
public class NotificationController {

    /** 저장된 targets는 JSON 문자열이다. 화면에 객체로 내려보내기 위해 여기서만 푼다. */
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @Operation(summary = "내 알림 목록",
            description = "처리 축(scope)과 읽음 축(readState)을 각각 받아 AND로 겹친다. "
                    + "생략하면 그 축으로 가리지 않는다. 개수는 필터와 무관한 전체 기준이다.")
    @GetMapping("/api/me/notifications")
    public NotificationPageResponse list(
            @RequestParam(required = false) String scope,
            @RequestParam(required = false) String readState,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "10") @Min(1) @Max(50) int size,
            Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        NotificationPage result = notificationService.list(userId, scope, readState, page, size);
        List<NotificationResponse> items = result.page().getContent().stream()
                .map(NotificationController::toResponse)
                .toList();
        return new NotificationPageResponse(
                items,
                result.page().getNumber(),
                result.page().getSize(),
                result.page().getTotalElements(),
                result.page().getTotalPages(),
                result.page().hasNext(),
                result.summary().unreadCount(),
                result.summary().actionRequiredCount());
    }

    @Operation(summary = "배지 개수", description = "종에 붙는 두 숫자. 화면이 60초마다 물어본다.")
    @GetMapping("/api/me/notifications/summary")
    public NotificationSummaryResponse summary(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return NotificationSummaryResponse.from(notificationService.summary(userId));
    }

    @Operation(summary = "개별 읽음",
            description = "읽음 축만 바꾼다. 처리 축은 건드리지 않는다 — 읽었다고 할 일이 사라지면 안 된다.")
    @PostMapping("/api/me/notifications/{notificationId}/read")
    public NotificationResponse markRead(@PathVariable UUID notificationId, Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return toResponse(notificationService.markRead(userId, notificationId));
    }

    @Operation(summary = "모두 읽음", description = "갱신 뒤의 개수를 돌려준다 — 화면이 배지를 즉시 맞출 수 있게.")
    @PostMapping("/api/me/notifications/read-all")
    public NotificationSummaryResponse markAllRead(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return NotificationSummaryResponse.from(notificationService.markAllRead(userId));
    }

    private static NotificationResponse toResponse(Notification notification) {
        return NotificationResponse.from(notification, readTargets(notification.getTargets()));
    }

    /**
     * targets를 객체로 푼다. 깨진 값이면 <b>빈 객체</b>로 둔다 — 저장된 JSON 하나 때문에 목록
     * 전체가 500이 되면 안 된다. 화면은 필요한 id가 없으면 이동을 포기할 뿐이다.
     */
    private static Object readTargets(String json) {
        if (json == null || json.isBlank()) {
            return JSON.createObjectNode();
        }
        try {
            JsonNode node = JSON.readTree(json);
            return node.isObject() ? node : JSON.createObjectNode();
        } catch (RuntimeException e) {
            return JSON.createObjectNode();
        }
    }
}

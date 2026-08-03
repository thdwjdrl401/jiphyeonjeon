package com.liveclass.notification.web;

import com.liveclass.notification.push.PushSubscriptionService;
import com.liveclass.notification.push.WebPushProperties;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Web Push 구독 관리(ADR-0073 §9).
 *
 * <p>구독 자체를 조회하는 경로는 두지 않는다. {@code p256dh}·{@code auth}는 <b>비밀</b>이라 내보낼
 * 수 없고, 그 둘을 뺀 목록은 "기기 목록" 화면이 생길 때 만들면 된다.
 */
@Tag(name = "웹 푸시", description = "브라우저 푸시 구독 등록·해제. 탭을 닫아도 알림이 온다.")
@RestController
public class PushSubscriptionController {

    private final PushSubscriptionService subscriptionService;
    private final WebPushProperties properties;

    public PushSubscriptionController(PushSubscriptionService subscriptionService,
                                      WebPushProperties properties) {
        this.subscriptionService = subscriptionService;
        this.properties = properties;
    }

    /**
     * 브라우저가 구독할 때 필요한 <b>공개</b>키. 개인키는 절대 나가지 않는다.
     *
     * <p>키가 설정돼 있지 않으면 {@code null}을 준다 — 화면은 그걸 보고 푸시 UI를 숨긴다. 404로
     * 주면 서버 장애와 구별되지 않는다.
     */
    @Operation(summary = "VAPID 공개키", description = "브라우저 구독에 필요한 공개키. 미설정이면 null.")
    @GetMapping("/api/me/push-subscriptions/public-key")
    public PublicKeyResponse publicKey() {
        return new PublicKeyResponse(properties.isConfigured() ? properties.publicKey() : null);
    }

    @Operation(summary = "구독 등록", description = "멱등이다 — 같은 엔드포인트면 갱신한다.")
    @PostMapping("/api/me/push-subscriptions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void register(@Valid @RequestBody RegisterRequest request,
                         @RequestHeader(value = "User-Agent", required = false) String userAgent,
                         Authentication authentication) {
        subscriptionService.register(UUID.fromString(authentication.getName()),
                request.endpoint(), request.p256dh(), request.auth(), userAgent);
    }

    @Operation(summary = "구독 해제", description = "본인 구독만 지운다. 없어도 성공이다(멱등).")
    @DeleteMapping("/api/me/push-subscriptions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unregister(@Valid @RequestBody UnregisterRequest request, Authentication authentication) {
        subscriptionService.unregister(UUID.fromString(authentication.getName()), request.endpoint());
    }

    public record PublicKeyResponse(String publicKey) {
    }

    public record RegisterRequest(
            @NotBlank String endpoint,
            @NotBlank String p256dh,
            @NotBlank String auth) {
    }

    public record UnregisterRequest(@NotBlank String endpoint) {
    }
}

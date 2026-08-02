package com.liveclass.live.web;

import com.liveclass.live.service.AnnotationInterpretImageStore;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 판서 해석 이미지를 <b>모델이 가져가는</b> 공개 경로(ADR-0058).
 *
 * <p><b>왜 공개인가.</b> 받아가는 쪽이 모델 제공자의 서버다 — 우리 세션 쿠키도, LiveKit 토큰도
 * 갖고 있지 않다. 인증을 걸 수 있는 주체가 아니므로 토큰 자체가 자격이 된다.
 *
 * <p>그래서 노출 창을 좁힌다: 128비트 난수 토큰, 짧은 TTL, 호출이 끝나면 즉시 폐기
 * ({@link AnnotationInterpretImageStore}). 여기서 지켜야 할 것은 <b>세션이나 소유권이 아니라
 * 수명</b>이다.
 *
 * <p>Swagger에 싣지 않는다. 사람이 부를 API가 아니다.
 */
@Hidden
@RestController
public class AnnotationInterpretImageController {

    private final AnnotationInterpretImageStore store;

    public AnnotationInterpretImageController(AnnotationInterpretImageStore store) {
        this.store = store;
    }

    @GetMapping("/api/annotation-interpret-images/{token}")
    public ResponseEntity<byte[]> get(@PathVariable String token) {
        return store.find(token)
                .map(entry -> ResponseEntity.ok()
                        // 어디에도 남기지 않는다 — 수명이 짧다는 전제가 캐시로 깨지면 안 된다.
                        .cacheControl(CacheControl.noStore())
                        .contentType(MediaType.parseMediaType(entry.mediaType()))
                        .body(entry.bytes()))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

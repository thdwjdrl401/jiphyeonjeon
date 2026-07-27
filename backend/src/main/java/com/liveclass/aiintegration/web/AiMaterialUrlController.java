package com.liveclass.aiintegration.web;

import com.liveclass.aiintegration.web.dto.AiMaterialUrlRequest;
import com.liveclass.aiintegration.web.dto.AiMaterialUrlResponse;
import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;
import java.util.UUID;

/**
 * AI 워커 → Spring, 자료 파일 다운로드 URL 주문형 발급(ADR-0036 B안). 워커가 임베딩 잡을 처리하기
 * <b>직전에</b> 호출해 갓 서명된 presigned GET URL을 받는다 — URL을 큐에 싣지 않으므로 TTL 만료 문제가
 * 없고(발급 즉시 사용), 워커는 스토리지 자격증명을 갖지 않는다(최소권한). 인증은 콜백과 같은 HMAC
 * 서명({@link AiCallbackVerifier}) — 본문은 원시 바이트로 받아 검증한다(재직렬화하면 서명이 어긋난다).
 */
@Tag(name = "AI Material URL", description = "AI 워커가 자료 파일을 읽을 presigned URL을 주문형으로 발급한다.")
@RestController
public class AiMaterialUrlController {

    private static final Logger log = LoggerFactory.getLogger(AiMaterialUrlController.class);

    private final AiCallbackVerifier verifier;
    private final AssetDirectory assetDirectory;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public AiMaterialUrlController(AiCallbackVerifier verifier, AssetDirectory assetDirectory) {
        this.verifier = verifier;
        this.assetDirectory = assetDirectory;
    }

    @Operation(summary = "자료 다운로드 URL 발급",
            description = "assetId의 MATERIAL 파일을 읽을 presigned GET URL을 발급한다. HMAC 서명으로 인증, 처리 직전 호출용(단명 URL).")
    @PostMapping(value = "/api/internal/ai/materials/download-url", consumes = MediaType.ALL_VALUE)
    public ResponseEntity<AiMaterialUrlResponse> issue(
            @RequestBody(required = false) byte[] body,
            @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verify(body, signature);

        AiMaterialUrlRequest req = jsonMapper.readValue(body, AiMaterialUrlRequest.class);
        if (req == null || req.assetId() == null || req.assetId().isBlank()) {
            return ResponseEntity.notFound().build();
        }
        UUID assetId;
        try {
            assetId = UUID.fromString(req.assetId());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
        // MATERIAL만 허용 — HMAC로 신뢰된 호출이지만 워커가 썸네일·프로필 이미지까지 읽지 못하게 좁힌다.
        Optional<AssetRef> ref = assetDirectory.find(assetId).filter(r -> "MATERIAL".equals(r.kind()));
        if (ref.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        // UPLOADED가 아니면(아직 안 올라옴) empty → 404. 워커는 나중에 다시 요청하면 된다.
        return assetDirectory.resolveUrl(assetId)
                .map(url -> {
                    log.info("AI 자료 URL 발급 assetId={}", assetId);
                    return ResponseEntity.ok(new AiMaterialUrlResponse(url));
                })
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

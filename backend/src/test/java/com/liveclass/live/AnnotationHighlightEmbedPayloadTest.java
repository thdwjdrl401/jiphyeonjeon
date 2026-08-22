package com.liveclass.live;

import com.liveclass.aiintegration.api.OutboxDestinations;
import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.live.domain.AnnotationHighlight;
import com.liveclass.live.repository.AnnotationHighlightRepository;
import com.liveclass.live.service.AnnotationHighlightDescribeWorker;
import com.liveclass.live.service.AnnotationHighlightDescriber;
import com.liveclass.live.service.AnnotationHighlightService;
import com.liveclass.live.service.AnnotationInterpretException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI에 보내는 강조 색인 잡의 계약(ADR-0074 결정 1).
 *
 * <p><b>이 페이로드가 AI 파트와의 계약 그 자체다.</b> 필드 이름이나 구조가 어긋나면 워커가 조용히
 * 무시하거나 엉뚱하게 색인하고, 그 어긋남은 수강생 답변의 근거가 이상해질 때야 드러난다. 그래서
 * 실제 발행 인자를 붙잡아 모양을 고정한다.
 *
 * <p>특히 <b>이미지를 싣지 않는다</b>는 것을 고정한다. AI 파트가 "이미지를 다시 OCR하지 않을 예정이라
 * 직접 접근이 불필요하다"고 답했으므로(MR !350), assetId나 URL이 페이로드에 들어가면 계약 위반이다.
 */
class AnnotationHighlightEmbedPayloadTest {

    private final AnnotationHighlightRepository repository = mock(AnnotationHighlightRepository.class);
    private final AnnotationHighlightDescriber describer = mock(AnnotationHighlightDescriber.class);
    private final AssetDirectory assets = mock(AssetDirectory.class);
    private final OutboxPublisher outbox = mock(OutboxPublisher.class);
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    private AnnotationHighlightDescribeWorker worker;
    private AnnotationHighlight highlight;

    @BeforeEach
    void setUp() {
        worker = new AnnotationHighlightDescribeWorker(repository, describer, assets, outbox, true);
        highlight = new AnnotationHighlight();
        highlight.setId(UUID.randomUUID());
        highlight.setLiveSessionId(UUID.randomUUID());
        highlight.setLessonId(UUID.randomUUID());
        highlight.setCurriculumId(UUID.randomUUID());
        highlight.setAssetId(UUID.randomUUID());
        highlight.setSessionMs(725_300L);
        highlight.setIndexStatus(AnnotationHighlightService.STATUS_PENDING);
        highlight.setCreatedAt(OffsetDateTime.now());
        when(repository.findById(highlight.getId())).thenReturn(Optional.of(highlight));
        when(assets.resolveUrl(highlight.getAssetId())).thenReturn(Optional.of("https://example.test/a.webp?sig=x"));
    }

    @Test
    void 설명을_텍스트로_실어_자료와_같은_큐로_보낸다() throws Exception {
        when(describer.describe(anyString())).thenReturn("이진 탐색의 시간복잡도는 O(log n)");

        worker.describeOne(highlight.getId());

        ArgumentCaptor<String> destination = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> eventType = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> idempotency = ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(destination.capture(), anyString(), anyString(), eventType.capture(),
                payload.capture(), idempotency.capture(), any());

        // 새 전송 방식을 만들지 않는다 — 자료 임베딩과 같은 큐·같은 봉투다(ADR-0036).
        assertThat(destination.getValue()).isEqualTo(OutboxDestinations.INGESTION_EMBED);
        assertThat(eventType.getValue()).isEqualTo("ANNOTATION_EMBED_REQUESTED");
        // 재발행이 와도 outbox UNIQUE가 조용히 무시한다.
        assertThat(idempotency.getValue()).isEqualTo("annotation-embed-" + highlight.getId());

        JsonNode body = jsonMapper.readTree(payload.getValue());
        assertThat(body.get("taskType").asString()).isEqualTo("ANNOTATION_EMBED");
        assertThat(body.get("highlightId").asString()).isEqualTo(highlight.getId().toString());
        // 같은 강의의 여러 라이브를 구분한다. sessionMs가 어느 세션의 축인지도 이 값이 정한다.
        assertThat(body.get("sessionId").asString()).isEqualTo(highlight.getLiveSessionId().toString());
        assertThat(body.get("lessonId").asString()).isEqualTo(highlight.getLessonId().toString());
        // 검색 스코프. 자료와 같은 축이라 한 커리큘럼 안에서 함께 검색된다.
        assertThat(body.get("curriculumId").asString()).isEqualTo(highlight.getCurriculumId().toString());
        // 다시보기 앵커. 근거를 누르면 그 시점으로 이동한다.
        assertThat(body.get("sessionMs").asLong()).isEqualTo(725_300L);
        assertThat(body.get("text").asString()).isEqualTo("이진 탐색의 시간복잡도는 O(log n)");
        assertThat(body.get("contractVersion").asInt()).isEqualTo(1);
        // 오프셋을 포함한 ISO-8601. 수신 측이 시각을 그대로 파싱할 수 있어야 한다.
        assertThat(java.time.OffsetDateTime.parse(body.get("capturedAt").asString()))
                .isEqualTo(highlight.getCreatedAt());
    }

    /** AI가 이미지를 받지 않기로 했다. assetId나 URL이 새어 들어가면 계약 위반이다. */
    @Test
    void 이미지는_싣지_않는다() throws Exception {
        when(describer.describe(anyString())).thenReturn("설명");

        worker.describeOne(highlight.getId());

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(anyString(), anyString(), anyString(), anyString(),
                payload.capture(), anyString(), any());
        assertThat(payload.getValue()).doesNotContain("assetId").doesNotContain("http");
    }

    /**
     * 보낸 뒤 상태는 <b>PROCESSING</b>이다. READY는 AI 콜백이 확정한다 — 여기서 READY로 두면
     * 강조 내역 화면이 강사에게 색인되지 않은 것을 "준비됨"이라고 말하게 된다.
     */
    @Test
    void 보낸_뒤_상태는_색인_대기다() {
        when(describer.describe(anyString())).thenReturn("설명");

        worker.describeOne(highlight.getId());

        assertThat(highlight.getIndexStatus()).isEqualTo(AnnotationHighlightService.STATUS_PROCESSING);
    }

    /** 읽지 못한 것은 보내지 않는다. 빈 근거가 검색에 걸리면 안 된다. */
    @Test
    void 읽지_못하면_보내지_않는다() {
        when(describer.describe(anyString())).thenReturn(null);

        worker.describeOne(highlight.getId());

        verify(outbox, never()).enqueue(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any());
        assertThat(highlight.getIndexStatus()).isEqualTo(AnnotationHighlightService.STATUS_FAILED);
    }

    /**
     * 일시적 실패는 물러섰다가 다시 온다. 재시도가 없으면 게이트웨이 5xx 하나로 그 캡처가 영영
     * 근거가 되지 못하고, 되돌리려면 사람이 SQL을 쳐야 한다.
     */
    @Test
    void 일시적_실패는_백오프_뒤_다시_시도한다() {
        when(describer.describe(anyString())).thenThrow(new AnnotationInterpretException("게이트웨이 오류"));

        worker.describeOne(highlight.getId());

        assertThat(highlight.getIndexStatus()).isEqualTo(AnnotationHighlightService.STATUS_PENDING);
        assertThat(highlight.getAttemptCount()).isEqualTo(1);
        assertThat(highlight.getNextAttemptAt()).isAfter(OffsetDateTime.now());
        assertThat(highlight.getLastError()).contains("게이트웨이");
        verify(outbox, never()).enqueue(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any());
    }

    /**
     * 변경이 <b>실제로 저장돼야</b> 한다.
     *
     * <p>이 메서드는 같은 빈의 스케줄러가 부르므로 프록시를 거치지 않는다 — {@code @Transactional}이
     * 적용되지 않아 엔티티가 detached였고, 더티 체킹이 안 돌아 attemptCount가 저장되지 않았다.
     * 운영에서 <b>매번 "시도=1"로 15초마다 영원히 재시도</b>하는 것으로 드러났다(GMS 401 상황).
     */
    @Test
    void 실패_상태를_실제로_저장한다() {
        when(describer.describe(anyString())).thenThrow(new AnnotationInterpretException("게이트웨이 오류"));

        worker.describeOne(highlight.getId());

        verify(repository).save(highlight);
    }

    @Test
    void 재시도를_다_쓰면_내린다() {
        when(describer.describe(anyString())).thenThrow(new AnnotationInterpretException("계속 실패"));
        highlight.setAttemptCount(3);

        worker.describeOne(highlight.getId());

        assertThat(highlight.getIndexStatus()).isEqualTo(AnnotationHighlightService.STATUS_FAILED);
    }
}

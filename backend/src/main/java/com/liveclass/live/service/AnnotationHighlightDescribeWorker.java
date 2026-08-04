package com.liveclass.live.service;

import com.liveclass.aiintegration.api.OutboxDestinations;
import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.live.domain.AnnotationHighlight;
import com.liveclass.live.repository.AnnotationHighlightRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Limit;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * 강조 캡처를 글로 옮기는 워커(ADR-0074).
 *
 * <p><b>왜 요청 스레드에서 하지 않는가.</b> 비전 모델 호출은 수 초가 걸린다. 저장 요청에서 그것을
 * 기다리면 강사는 이유 없이 멈춰 있고, 라이브 중에 반복되면 Tomcat 스레드 풀을 잠식한다. 저장은
 * 즉시 끝내고({@code PENDING}), 설명은 여기서 뒤따라 붙인다 — 강사는 강조 내역 탭에서 상태를 본다.
 *
 * <p><b>이미지는 presigned URL을 그대로 준다.</b> 그 URL은 공개 도메인으로 서명돼 nginx가 프록시하므로
 * 모델이 직접 가져갈 수 있다. 바이트를 서버로 내렸다가 임시 저장소에 다시 올리는 왕복이 필요 없다.
 * 발급은 <b>호출 직전</b>에 한다 — 미리 만들어 두면 큐에서 기다리는 동안 만료된다.
 *
 * <p>한 번에 조금씩만 처리한다. 라이브 중에 강사가 연달아 강조하면 캡처가 몰리는데, 그걸 한 틱에
 * 다 부르면 모델 게이트웨이가 막히고 그 실패가 전부에게 번진다.
 */
@Component
public class AnnotationHighlightDescribeWorker {

    private static final Logger log = LoggerFactory.getLogger(AnnotationHighlightDescribeWorker.class);

    /** 한 틱에 처리할 최대 건수. 모델 호출이 직렬이라 이 값이 곧 틱당 소요 시간이다. */
    private static final int BATCH_SIZE = 5;

    /**
     * 설명 시도 상한. 넘으면 FAILED로 내린다.
     *
     * <p>모델이 못 읽는 판서는 몇 번을 불러도 못 읽는다. 재시도는 <b>일시적 장애</b>(게이트웨이 5xx,
     * 네트워크)를 위한 것이지 인식률을 올리려는 것이 아니다.
     */
    private static final int MAX_ATTEMPTS = 4;

    /** 지수 백오프 기준. 1분 → 2분 → 4분. */
    private static final Duration BACKOFF_BASE = Duration.ofMinutes(1);

    private final AnnotationHighlightRepository repository;
    private final AnnotationHighlightDescriber describer;
    private final AssetDirectory assetDirectory;
    private final OutboxPublisher outboxPublisher;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final boolean enabled;

    public AnnotationHighlightDescribeWorker(AnnotationHighlightRepository repository,
                                             AnnotationHighlightDescriber describer,
                                             AssetDirectory assetDirectory,
                                             OutboxPublisher outboxPublisher,
                                             @Value("${annotation.highlight.describe.enabled:false}") boolean enabled) {
        this.repository = repository;
        this.describer = describer;
        this.assetDirectory = assetDirectory;
        this.outboxPublisher = outboxPublisher;
        this.enabled = enabled;
    }

    /**
     * 아직 설명이 붙지 않은 캡처를 처리한다.
     *
     * <p>스위치 뒤에 둔다. 꺼져 있으면 캡처는 그대로 쌓이되 모델을 부르지 않는다 — 키가 없는 환경
     * (로컬·테스트)에서 스케줄러가 실패를 반복하지 않게 하기 위해서다(ADR-0036과 같은 규칙).
     */
    @Scheduled(fixedDelayString = "${annotation.highlight.describe.interval-ms:15000}")
    public void describePending() {
        if (!enabled) {
            return;
        }
        List<AnnotationHighlight> pending = repository.findDescribable(
                AnnotationHighlightService.STATUS_PENDING, OffsetDateTime.now(), Limit.of(BATCH_SIZE));
        for (AnnotationHighlight highlight : pending) {
            describeOne(highlight.getId());
        }
    }

    /**
     * 한 건을 처리한다.
     *
     * <p><b>변경을 명시적으로 저장한다.</b> 이 메서드는 같은 빈의 {@link #describePending()}이 부르므로
     * 프록시를 거치지 않는다 — {@code @Transactional}을 붙여도 적용되지 않는다(Spring 자기호출).
     * 그래서 엔티티가 detached였고 더티 체킹이 돌지 않아 attemptCount·nextAttemptAt이 저장되지 않았다.
     * 운영에서 <b>매번 "시도=1"로 15초마다 영원히 재시도</b>하는 것으로 드러났다.
     *
     * <p>트랜잭션을 프록시로 되살리는 대신 저장을 명시한다 — 모델 호출을 기다리는 동안 트랜잭션을
     * 열어 두지 않는 편이 낫다. 다만 색인 잡 적재는 텍스트 저장과 함께여야 하므로
     * {@link #saveAndEnqueue}에서 한 트랜잭션으로 묶는다.
     */
    public void describeOne(java.util.UUID highlightId) {
        AnnotationHighlight highlight = repository.findById(highlightId).orElse(null);
        if (highlight == null || !AnnotationHighlightService.STATUS_PENDING.equals(highlight.getIndexStatus())) {
            return;   // 그 사이 지워졌거나 이미 처리됐다.
        }
        String imageUrl = assetDirectory.resolveUrl(highlight.getAssetId()).orElse(null);
        if (imageUrl == null) {
            // 에셋이 없는 것은 다시 시도해도 같다. 바로 내린다.
            fail(highlight, "이미지를 찾을 수 없습니다");
            repository.save(highlight);
            return;
        }
        try {
            String text = describer.describe(imageUrl);
            if (text == null) {
                // 모델이 정상 동작했고 화면을 알아볼 수 없었을 뿐이다. 다시 불러도 같으므로 내린다.
                fail(highlight, "화면을 알아보지 못했습니다");
                repository.save(highlight);
                return;
            }
            highlight.setInterpretedText(text);
            highlight.setLastError(null);
            /*
             * 텍스트 저장과 색인 잡 적재를 <b>같은 트랜잭션</b>에 둔다(ADR-0036). 그래야 "텍스트는
             * 저장됐는데 AI에는 안 갔다"가 구조적으로 불가능해진다.
             *
             * PROCESSING은 "보냈고 색인 결과를 기다린다"는 뜻이다. READY는 AI 콜백이 확정한다 —
             * 여기서 READY로 두면 강사에게 색인되지 않은 것을 준비됐다고 말하게 된다.
             */
            saveAndEnqueue(highlight);
            log.info("강조 설명 완료·색인 요청 highlightId={} 길이={}", highlight.getId(), text.length());
        } catch (RuntimeException e) {
            retryOrFail(highlight, e.getMessage());
            repository.save(highlight);
        }
    }

    /** 텍스트 저장과 색인 잡 적재를 한 트랜잭션으로 묶는다(ADR-0036). 둘이 갈라지면 안 된다. */
    @Transactional
    public void saveAndEnqueue(AnnotationHighlight highlight) {
        highlight.setIndexStatus(AnnotationHighlightService.STATUS_PROCESSING);
        repository.save(highlight);
        enqueueEmbed(highlight);
    }

    /**
     * 색인 잡을 outbox에 싣는다(ADR-0074 결정 1).
     *
     * <p><b>이미지를 보내지 않는다.</b> AI 파트가 "이미지를 다시 OCR하지 않을 예정이라 직접 접근이
     * 불필요하다"고 답했고(MR !350), 그래서 assetId도 presigned 경로도 페이로드에 없다. 본체는 텍스트다.
     *
     * <p>멱등키는 {@code highlightId}다. 재발행이 와도 outbox의 UNIQUE가 조용히 무시한다.
     */
    private void enqueueEmbed(AnnotationHighlight highlight) {
        String payload = jsonMapper.writeValueAsString(Map.of(
                "taskType", "ANNOTATION_EMBED",
                "highlightId", highlight.getId().toString(),
                // 세션 식별자. lessonId만으로는 같은 강의의 여러 라이브를 구분할 수 없다 —
                // 다시보기 앵커(sessionMs)가 어느 세션의 축인지도 이 값이 정한다.
                "sessionId", highlight.getLiveSessionId().toString(),
                "lessonId", highlight.getLessonId().toString(),
                "curriculumId", highlight.getCurriculumId().toString(),
                "sessionMs", highlight.getSessionMs() == null ? 0L : highlight.getSessionMs(),
                // 오프셋을 포함한 ISO-8601. toString()은 나노초 자릿수가 값마다 달라져 수신 측
                // 파서가 흔들릴 수 있다 — 형식을 명시해 고정한다.
                "capturedAt", highlight.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                "text", highlight.getInterpretedText(),
                "policy", Map.of("embedModel", "bge-m3"),
                "contractVersion", 1));
        outboxPublisher.enqueue(OutboxDestinations.INGESTION_EMBED, "annotation_highlight",
                highlight.getId().toString(), "ANNOTATION_EMBED_REQUESTED",
                payload, "annotation-embed-" + highlight.getId(), null);
    }

    /**
     * 일시적 실패는 물러섰다가 다시 온다. 상한을 넘으면 내린다.
     *
     * <p>재시도가 없으면 게이트웨이 5xx 하나로 그 캡처가 영영 근거가 되지 못하고, 되돌리려면 사람이
     * SQL을 쳐야 한다. outbox가 같은 문제를 이미 이렇게 풀었다(ADR-0036).
     */
    private void retryOrFail(AnnotationHighlight highlight, String reason) {
        int attempts = highlight.getAttemptCount() + 1;
        highlight.setAttemptCount(attempts);
        highlight.setLastError(reason);
        if (attempts >= MAX_ATTEMPTS) {
            highlight.setIndexStatus(AnnotationHighlightService.STATUS_FAILED);
            log.warn("강조 설명 실패 — 재시도 소진 highlightId={} 시도={} 사유={}",
                    highlight.getId(), attempts, reason);
            return;
        }
        highlight.setNextAttemptAt(OffsetDateTime.now().plus(BACKOFF_BASE.multipliedBy(1L << (attempts - 1))));
        log.warn("강조 설명 실패 — 재시도 예정 highlightId={} 시도={} 다음={} 사유={}",
                highlight.getId(), attempts, highlight.getNextAttemptAt(), reason);
    }

    /** 다시 시도해도 결과가 같은 실패. 재시도 없이 내린다. */
    private void fail(AnnotationHighlight highlight, String reason) {
        highlight.setIndexStatus(AnnotationHighlightService.STATUS_FAILED);
        highlight.setLastError(reason);
        log.warn("강조 설명 실패 highlightId={} 사유={}", highlight.getId(), reason);
    }
}

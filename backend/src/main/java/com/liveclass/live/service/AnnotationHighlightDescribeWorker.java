package com.liveclass.live.service;

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

import java.util.List;

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

    private final AnnotationHighlightRepository repository;
    private final AnnotationHighlightDescriber describer;
    private final AssetDirectory assetDirectory;
    private final boolean enabled;

    public AnnotationHighlightDescribeWorker(AnnotationHighlightRepository repository,
                                             AnnotationHighlightDescriber describer,
                                             AssetDirectory assetDirectory,
                                             @Value("${annotation.highlight.describe.enabled:false}") boolean enabled) {
        this.repository = repository;
        this.describer = describer;
        this.assetDirectory = assetDirectory;
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
        List<AnnotationHighlight> pending = repository
                .findByIndexStatusAndRemovedAtIsNullOrderByCreatedAtAsc(
                        AnnotationHighlightService.STATUS_PENDING, Limit.of(BATCH_SIZE));
        for (AnnotationHighlight highlight : pending) {
            describeOne(highlight.getId());
        }
    }

    /**
     * 한 건을 처리한다. <b>건마다 트랜잭션을 따로 연다</b> — 하나가 실패해도 앞서 성공한 것이
     * 되돌아가지 않고, 모델 호출을 기다리는 동안 트랜잭션이 열려 있지도 않다.
     */
    @Transactional
    public void describeOne(java.util.UUID highlightId) {
        AnnotationHighlight highlight = repository.findById(highlightId).orElse(null);
        if (highlight == null || !AnnotationHighlightService.STATUS_PENDING.equals(highlight.getIndexStatus())) {
            return;   // 그 사이 지워졌거나 이미 처리됐다.
        }
        String imageUrl = assetDirectory.resolveUrl(highlight.getAssetId()).orElse(null);
        if (imageUrl == null) {
            markFailed(highlight, "이미지를 찾을 수 없습니다");
            return;
        }
        try {
            String text = describer.describe(imageUrl);
            if (text == null) {
                // 모델이 정상 동작했고 판서를 알아볼 수 없었을 뿐이다. 빈 근거를 색인하지 않는다.
                markFailed(highlight, "화면을 알아보지 못했습니다");
                return;
            }
            highlight.setInterpretedText(text);
            highlight.setIndexStatus(AnnotationHighlightService.STATUS_READY);
            log.info("강조 설명 완료 highlightId={} 길이={}", highlight.getId(), text.length());
        } catch (RuntimeException e) {
            markFailed(highlight, e.getMessage());
        }
    }

    private void markFailed(AnnotationHighlight highlight, String reason) {
        highlight.setIndexStatus(AnnotationHighlightService.STATUS_FAILED);
        log.warn("강조 설명 실패 highlightId={} 사유={}", highlight.getId(), reason);
    }
}

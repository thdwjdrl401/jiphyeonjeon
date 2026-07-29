package com.liveclass.live.service;

import com.liveclass.live.config.CaptionStreamProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

/**
 * Redis 자막 Stream 엔트리 처리(CONTRACT §3-4). 필드 파싱 → type 분기 → 멱등 저장 → <b>엔트리별 XACK</b>.
 * 참조 구현 {@code ai/ai-api/app/adapters/redis_caption_consumer.py}와 대칭:
 * <ul>
 *   <li>파싱 불가(poison)면 로그 후 ACK로 폐기한다 — 재시도해도 같은 결과라 pending에 남기지 않는다.</li>
 *   <li>저장 성공/멱등 중복 모두 ACK한다(중복은 이미 반영된 것).</li>
 *   <li>일시적 오류(DB 장애 등)는 다시 던진다 → ACK하지 않아 pending에 남고, 재기동 drain·재소비로 복구된다
 *       (at-least-once).</li>
 * </ul>
 */
@Component
public class CaptionStreamListener implements StreamListener<String, MapRecord<String, String, String>> {

    private static final Logger log = LoggerFactory.getLogger(CaptionStreamListener.class);

    private final CaptionEventParser parser;
    private final LiveCaptionService captionService;
    private final StringRedisTemplate redisTemplate;
    private final CaptionStreamProperties properties;

    public CaptionStreamListener(CaptionEventParser parser,
                                 LiveCaptionService captionService,
                                 StringRedisTemplate redisTemplate,
                                 CaptionStreamProperties properties) {
        this.parser = parser;
        this.captionService = captionService;
        this.redisTemplate = redisTemplate;
        this.properties = properties;
    }

    @Override
    public void onMessage(MapRecord<String, String, String> record) {
        RecordId recordId = record.getId();
        CaptionEvent event;
        try {
            event = parser.parse(record.getValue());
        } catch (CaptionParseException poison) {
            log.warn("자막 엔트리 폐기(파싱 실패) id={} reason={}", recordId, poison.getMessage());
            acknowledge(recordId);   // poison → ACK 폐기
            return;
        }
        // 저장 실패(일시적)는 여기서 던져 ACK를 건너뛴다 → pending 유지(재소비 대상).
        captionService.persist(event);
        acknowledge(recordId);
    }

    private void acknowledge(RecordId recordId) {
        Long acked = redisTemplate.opsForStream()
                .acknowledge(properties.streamKey(), properties.effectiveGroup(), recordId);
        if (acked == null || acked == 0) {
            log.warn("자막 엔트리 ACK가 pending을 제거하지 못함 id={}", recordId);
        }
    }
}

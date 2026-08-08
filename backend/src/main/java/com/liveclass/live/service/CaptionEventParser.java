package com.liveclass.live.service;

import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Redis 자막 엔트리(모든 값 문자열) → {@link CaptionEvent} 파싱·검증. 와이어 정본
 * {@code caption-stream-entry.schema.json}의 필드 규칙을 강제한다:
 * <ul>
 *   <li>{@code contractVersion="1"}, {@code type} 4종만 허용(delta·completed·started·segment.final).</li>
 *   <li>정수 필드(sequence·lastSequence·streamElapsedMs·segmentIndex·start/endStreamElapsedMs)는
 *       부호 없는 십진 문자열(최대 18자리).</li>
 *   <li>{@code sessionId}·{@code lessonId}는 canonical UUID, {@code eventId}·{@code sttSessionId}는
 *       safeIdentifier(UUID 아님).</li>
 *   <li>{@code audioStartedAt}(started)는 UTC(Z 또는 +00:00) date-time, {@code boundaryReason}
 *       (segment.final)은 SILENCE·MAX_DURATION·STREAM_END만 허용.</li>
 * </ul>
 * 위반은 {@link CaptionParseException}(unchecked)으로 던진다 — consumer가 poison으로 ACK 폐기한다
 * (참조 구현 {@code ai/ai-api/app/adapters/redis_caption_consumer.py}와 대칭).
 */
@Component
public class CaptionEventParser {

    private static final String CONTRACT_VERSION = "1";
    private static final int MAX_TEXT_LENGTH = 10_000;
    private static final String COMPLETED_REASON = "ROOM_DELETED";
    private static final Set<String> BOUNDARY_REASONS = Set.of("SILENCE", "MAX_DURATION", "STREAM_END");

    /** 부호 없는 십진, 최대 18자리(스키마 nonNegativeIntegerString). Long 범위 안에 든다. */
    private static final Pattern UNSIGNED_DECIMAL = Pattern.compile("^(0|[1-9][0-9]{0,17})$");
    private static final Pattern SAFE_IDENTIFIER = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$");

    public CaptionEvent parse(Map<String, String> fields) {
        if (fields == null || fields.isEmpty()) {
            throw new CaptionParseException("빈 자막 엔트리");
        }
        requireEquals(fields, "contractVersion", CONTRACT_VERSION);
        String type = requirePresent(fields, "type");
        String eventId = safeIdentifier(fields, "eventId");
        UUID sessionId = uuid(fields, "sessionId");
        UUID lessonId = uuid(fields, "lessonId");
        String sttSessionId = safeIdentifier(fields, "sttSessionId");
        OffsetDateTime occurredAt = timestamp(fields, "occurredAt");

        return switch (type) {
            case CaptionEvent.TYPE_DELTA -> new CaptionEvent(
                    eventId, type, sessionId, lessonId, sttSessionId,
                    unsignedLong(fields, "sequence"), null,
                    unsignedLong(fields, "streamElapsedMs"),
                    text(fields), null, occurredAt,
                    null, null, null, null, null, null, null);
            case CaptionEvent.TYPE_COMPLETED -> new CaptionEvent(
                    eventId, type, sessionId, lessonId, sttSessionId,
                    null, unsignedLong(fields, "lastSequence"),
                    unsignedLong(fields, "streamElapsedMs"),
                    null, requireEquals(fields, "reason", COMPLETED_REASON), occurredAt,
                    null, null, null, null, null, null, null);
            case CaptionEvent.TYPE_STARTED -> new CaptionEvent(
                    eventId, type, sessionId, lessonId, sttSessionId,
                    null, null, null, null, null, occurredAt,
                    utcTimestamp(fields, "audioStartedAt"), null, null, null, null, null, null);
            case CaptionEvent.TYPE_SEGMENT_FINAL -> new CaptionEvent(
                    eventId, type, sessionId, lessonId, sttSessionId,
                    null, unsignedLong(fields, "lastSequence"), null,
                    text(fields), null, occurredAt, null,
                    unsignedLong(fields, "segmentIndex"),
                    unsignedLong(fields, "startStreamElapsedMs"),
                    unsignedLong(fields, "endStreamElapsedMs"),
                    boundaryReason(fields),
                    optionalUtcTimestamp(fields, "startedAt"),
                    optionalUtcTimestamp(fields, "endedAt"));
            default -> throw new CaptionParseException("알 수 없는 자막 type: " + type);
        };
    }

    private String requirePresent(Map<String, String> fields, String key) {
        String value = fields.get(key);
        if (value == null || value.isEmpty()) {
            throw new CaptionParseException("필수 필드 누락: " + key);
        }
        return value;
    }

    private String requireEquals(Map<String, String> fields, String key, String expected) {
        String value = requirePresent(fields, key);
        if (!expected.equals(value)) {
            throw new CaptionParseException(key + " 기대값 " + expected + " != " + value);
        }
        return value;
    }

    private String safeIdentifier(Map<String, String> fields, String key) {
        String value = requirePresent(fields, key);
        if (!SAFE_IDENTIFIER.matcher(value).matches()) {
            throw new CaptionParseException(key + " safeIdentifier 형식 위반");
        }
        return value;
    }

    private UUID uuid(Map<String, String> fields, String key) {
        String value = requirePresent(fields, key);
        try {
            UUID parsed = UUID.fromString(value);
            // canonical 소문자 표기만 허용(스키마 pattern). UUID.fromString은 대문자·비정규도 통과하므로 재검증.
            if (!parsed.toString().equals(value)) {
                throw new CaptionParseException(key + " canonical UUID 아님");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new CaptionParseException(key + " UUID 파싱 실패");
        }
    }

    private long unsignedLong(Map<String, String> fields, String key) {
        String value = requirePresent(fields, key);
        if (!UNSIGNED_DECIMAL.matcher(value).matches()) {
            throw new CaptionParseException(key + " 부호 없는 십진 문자열 아님: " + value);
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new CaptionParseException(key + " 정수 범위 초과");
        }
    }

    private String text(Map<String, String> fields) {
        String value = requirePresent(fields, "text");
        if (value.length() > MAX_TEXT_LENGTH) {
            throw new CaptionParseException("text 최대 길이 초과");
        }
        return value;
    }

    private OffsetDateTime timestamp(Map<String, String> fields, String key) {
        String value = requirePresent(fields, key);
        try {
            return OffsetDateTime.parse(value);
        } catch (DateTimeParseException e) {
            throw new CaptionParseException(key + " date-time 파싱 실패");
        }
    }

    /**
     * UTC date-time({@code audioStartedAt}). 스키마 pattern {@code (Z|+00:00)$}를 강제한다 — 시각 앵커라
     * 오프셋 표기를 UTC로 고정해 소비 측 변환 오차를 없앤다.
     */
    private OffsetDateTime utcTimestamp(Map<String, String> fields, String key) {
        OffsetDateTime parsed = timestamp(fields, key);
        if (!parsed.getOffset().equals(ZoneOffset.UTC)) {
            throw new CaptionParseException(key + " UTC(Z 또는 +00:00) 아님");
        }
        return parsed;
    }

    /**
     * 있으면 UTC date-time, 없으면 null(ADR-0107의 선택 필드).
     *
     * <p><b>없는 것과 잘못된 것을 구분한다.</b> 없으면 소비자가 근사 축으로 물러나면 되지만, 값이
     * 있는데 형식이 틀린 것은 생산자 결함이라 조용히 넘기면 안 된다.
     */
    private OffsetDateTime optionalUtcTimestamp(Map<String, String> fields, String key) {
        String value = fields.get(key);
        return value == null || value.isEmpty() ? null : utcTimestamp(fields, key);
    }

    private String boundaryReason(Map<String, String> fields) {
        String value = requirePresent(fields, "boundaryReason");
        if (!BOUNDARY_REASONS.contains(value)) {
            throw new CaptionParseException("boundaryReason 허용값 아님: " + value);
        }
        return value;
    }
}

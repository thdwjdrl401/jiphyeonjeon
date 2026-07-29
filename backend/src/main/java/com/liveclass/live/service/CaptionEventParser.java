package com.liveclass.live.service;

import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Redis 자막 엔트리(모든 값 문자열) → {@link CaptionEvent} 파싱·검증. 와이어 정본
 * {@code caption-stream-entry.schema.json}의 필드 규칙을 강제한다:
 * <ul>
 *   <li>{@code contractVersion="1"}, {@code type} 2종만 허용.</li>
 *   <li>정수 필드(sequence·lastSequence·streamElapsedMs)는 부호 없는 십진 문자열(최대 18자리).</li>
 *   <li>{@code sessionId}·{@code lessonId}는 canonical UUID, {@code eventId}·{@code sttSessionId}는
 *       safeIdentifier(UUID 아님).</li>
 * </ul>
 * 위반은 {@link CaptionParseException}(unchecked)으로 던진다 — consumer가 poison으로 ACK 폐기한다
 * (참조 구현 {@code ai/ai-api/app/adapters/redis_caption_consumer.py}와 대칭).
 */
@Component
public class CaptionEventParser {

    private static final String CONTRACT_VERSION = "1";
    private static final int MAX_TEXT_LENGTH = 10_000;
    private static final String COMPLETED_REASON = "ROOM_DELETED";

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
                    text(fields), null, occurredAt);
            case CaptionEvent.TYPE_COMPLETED -> new CaptionEvent(
                    eventId, type, sessionId, lessonId, sttSessionId,
                    null, unsignedLong(fields, "lastSequence"),
                    unsignedLong(fields, "streamElapsedMs"),
                    null, requireEquals(fields, "reason", COMPLETED_REASON), occurredAt);
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
}

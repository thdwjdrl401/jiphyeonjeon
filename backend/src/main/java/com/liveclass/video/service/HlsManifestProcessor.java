package com.liveclass.video.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HLS manifest의 시간축 metadata 분석과 객체 URI presign 재작성을 담당한다.
 * 저장소 I/O와 접근 제어는 호출자가 담당한다.
 */
@Component
public class HlsManifestProcessor {

    private static final Logger log = LoggerFactory.getLogger(HlsManifestProcessor.class);
    private static final String PDT_TAG = "#EXT-X-PROGRAM-DATE-TIME:";
    private static final String EXTINF_TAG = "#EXTINF:";
    private static final Pattern TAG_URI_ATTR = Pattern.compile("URI=\"([^\"]*)\"");

    private final ReplayStorage replayStorage;

    public HlsManifestProcessor(ReplayStorage replayStorage) {
        this.replayStorage = replayStorage;
    }

    /** 첫 PDT와 EXTINF 합계로 세션 상대 재생 범위를 계산한다. */
    public ManifestSnapshot analyze(String manifest, OffsetDateTime sessionStartedAt) {
        OffsetDateTime firstPdt = null;
        double totalSeconds = 0;

        for (String line : manifest.split("\\R", -1)) {
            String trimmed = line.strip();
            if (firstPdt == null && trimmed.startsWith(PDT_TAG)) {
                firstPdt = parseProgramDateTime(trimmed.substring(PDT_TAG.length()));
            } else if (trimmed.startsWith(EXTINF_TAG)) {
                totalSeconds += parseExtinfSeconds(trimmed);
            }
        }

        Long sessionOffsetMs = firstPdt != null && sessionStartedAt != null
                ? Duration.between(sessionStartedAt, firstPdt).toMillis()
                : null;
        long availableFromMs = sessionOffsetMs != null ? sessionOffsetMs : 0L;
        long totalDurationMs = Math.round(totalSeconds * 1000);
        return new ManifestSnapshot(
                sessionOffsetMs,
                totalDurationMs,
                availableFromMs,
                availableFromMs + totalDurationMs);
    }

    /** 일반 URI 줄과 MAP/KEY URI 속성을 같은 manifest 디렉터리의 presigned GET URL로 바꾼다. */
    public String rewrite(String manifest, String bucket, String manifestKey, Duration ttl) {
        String keyPrefix = keyPrefix(manifestKey);
        String[] lines = manifest.split("\\R", -1);
        StringBuilder out = new StringBuilder(manifest.length() + 512);

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.strip();
            if (trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-KEY:")) {
                out.append(rewriteTagUri(line, bucket, keyPrefix, ttl));
            } else if (!trimmed.isEmpty() && !trimmed.startsWith("#")) {
                out.append(rewriteObjectUri(trimmed, bucket, keyPrefix, ttl));
            } else {
                out.append(line);
            }
            if (i < lines.length - 1) {
                out.append('\n');
            }
        }
        return out.toString();
    }

    private String rewriteTagUri(String line, String bucket, String keyPrefix, Duration ttl) {
        Matcher matcher = TAG_URI_ATTR.matcher(line);
        if (!matcher.find()) {
            return line;
        }
        String replacement = rewriteObjectUri(matcher.group(1), bucket, keyPrefix, ttl);
        return new StringBuilder(line)
                .replace(matcher.start(1), matcher.end(1), replacement)
                .toString();
    }

    private String rewriteObjectUri(String value, String bucket, String keyPrefix, Duration ttl) {
        URI uri = parseUri(value);
        if (uri.isAbsolute()) {
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) {
                throw invalidUri(value);
            }
            log.warn("HLS manifest에 절대 URL이 있어 presign하지 않고 유지함: {}", value);
            return value;
        }
        if (uri.getRawAuthority() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw invalidUri(value);
        }

        String path = uri.getPath();
        if (path == null || path.isBlank()) {
            throw invalidUri(value);
        }
        String objectKey = resolveObjectKey(keyPrefix, path);
        return replayStorage.presignSegment(bucket, objectKey, ttl);
    }

    private URI parseUri(String value) {
        try {
            return new URI(value);
        } catch (URISyntaxException e) {
            throw invalidUri(value);
        }
    }

    private String resolveObjectKey(String keyPrefix, String relativePath) {
        Path base = Path.of(keyPrefix).normalize();
        Path resolved = base.resolve(relativePath).normalize();
        if (resolved.isAbsolute() || !resolved.startsWith(base)) {
            throw invalidUri(relativePath);
        }
        return resolved.toString().replace('\\', '/');
    }

    private ReplayManifestInvalidException invalidUri(String value) {
        return new ReplayManifestInvalidException("안전하게 서빙할 수 없는 manifest URI입니다: " + value);
    }

    private OffsetDateTime parseProgramDateTime(String value) {
        try {
            return OffsetDateTime.parse(value.strip());
        } catch (DateTimeParseException e) {
            log.debug("HLS PROGRAM-DATE-TIME 파싱 실패: {}", value);
            return null;
        }
    }

    private double parseExtinfSeconds(String line) {
        String duration = line.substring(EXTINF_TAG.length());
        int comma = duration.indexOf(',');
        if (comma >= 0) {
            duration = duration.substring(0, comma);
        }
        try {
            return Double.parseDouble(duration.strip());
        } catch (NumberFormatException e) {
            log.debug("HLS EXTINF 파싱 실패: {}", line);
            return 0;
        }
    }

    private String keyPrefix(String manifestKey) {
        int slash = manifestKey.lastIndexOf('/');
        return slash < 0 ? "" : manifestKey.substring(0, slash + 1);
    }

    public record ManifestSnapshot(
            Long sessionOffsetMs,
            long totalDurationMs,
            long availableFromMs,
            long availableToMs
    ) {
    }
}

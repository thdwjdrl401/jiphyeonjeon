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
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HLS manifest의 시간축 분석, 델타 재생목록 생성, 객체 URI presign 재작성을 담당한다.
 * 저장소 I/O와 접근 제어는 호출자가 담당한다.
 *
 * <p><b>델타 재생목록</b>(RFC 8216bis §6.2.5.1): 라이브 중 재생목록은 세션이 길어질수록 계속 자라는데
 * 플레이어는 이를 targetDuration 주기로 다시 받는다. 2초 세그먼트 2시간이면 3600엔트리이고, presigned
 * 재작성 후에는 엔트리당 300바이트를 넘어 매 갱신이 MB 단위가 된다.
 *
 * <p>해법은 잘라 보내는 것이 아니다. 짧은 재생목록은 플레이어에게 "나머지는 사라졌다"는 뜻이라 진행 바가
 * 쪼그라든다. {@code #EXT-X-SKIP}은 "생략했을 뿐이니 갖고 있는 것과 병합하라"는 신호이고, 그래서
 * {@code #EXT-X-MEDIA-SEQUENCE}도 건드리지 않는다 — 재생목록의 논리적 시작점은 그대로다.
 *
 * <p>협상은 클라이언트가 주도한다. 서버가 {@code CAN-SKIP-UNTIL}로 능력을 광고하면 플레이어가
 * {@code _HLS_skip=YES}를 붙여 요청한다. 서버는 클라이언트별 상태를 들지 않는다.
 */
@Component
public class HlsManifestProcessor {

    private static final Logger log = LoggerFactory.getLogger(HlsManifestProcessor.class);
    private static final String PDT_TAG = "#EXT-X-PROGRAM-DATE-TIME:";
    private static final String EXTINF_TAG = "#EXTINF:";
    private static final String VERSION_TAG = "#EXT-X-VERSION:";
    private static final String ENDLIST_TAG = "#EXT-X-ENDLIST";
    private static final String SERVER_CONTROL_TAG = "#EXT-X-SERVER-CONTROL:";
    private static final Pattern TAG_URI_ATTR = Pattern.compile("URI=\"([^\"]*)\"");
    /** {@code EXT-X-SKIP}을 쓰려면 재생목록 버전이 9 이상이어야 한다(RFC 8216bis §4.4.3.2). */
    private static final int DELTA_MIN_VERSION = 9;

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

    /** 라이브 중인 재생목록인가 — {@code #EXT-X-ENDLIST}가 없으면 아직 자라는 중이다. */
    public boolean isLive(String manifest) {
        return manifest.lines().noneMatch(line -> line.strip().startsWith(ENDLIST_TAG));
    }

    /**
     * 델타 재생목록을 줄 수 있다고 광고한다({@code CAN-SKIP-UNTIL}). 플레이어는 이걸 보고서야
     * {@code _HLS_skip=YES}를 붙인다. {@code EXT-X-SKIP} 사용 조건인 버전 9도 여기서 맞춘다.
     */
    public String withServerControl(String manifest, Duration canSkipUntil) {
        Playlist playlist = Playlist.parse(manifest);
        List<String> header = new ArrayList<>(playlist.header());
        header.removeIf(line -> line.strip().startsWith(SERVER_CONTROL_TAG));
        raiseVersion(header);
        header.add(SERVER_CONTROL_TAG + "CAN-SKIP-UNTIL=" + formatSeconds(canSkipUntil));
        return playlist.withHeader(header).render();
    }

    /**
     * 경계보다 오래된 세그먼트를 {@code #EXT-X-SKIP}으로 대체한다. 생략할 게 없으면 원본 그대로 —
     * 스펙상 빈 skip 태그를 붙일 이유가 없다.
     *
     * <p>경계는 <b>재생목록 끝에서부터</b> 잰다. 뒤에서 EXTINF를 누적해 {@code skipBoundary}를 넘는
     * 지점 앞을 전부 생략한다. {@code EXT-X-MEDIA-SEQUENCE}는 손대지 않는다 — 생략은 삭제가 아니다.
     */
    public String skip(String manifest, Duration skipBoundary) {
        Playlist playlist = Playlist.parse(manifest);
        List<Segment> segments = playlist.segments();

        double boundarySeconds = skipBoundary.toMillis() / 1000.0;
        double retained = 0;
        int firstRetainedIndex = segments.size();
        while (firstRetainedIndex > 0 && retained < boundarySeconds) {
            retained += segments.get(firstRetainedIndex - 1).durationSeconds();
            firstRetainedIndex--;
        }
        if (firstRetainedIndex <= 0) {
            return manifest;   // 경계 안에 다 들어온다 — 생략할 게 없다.
        }

        List<String> header = new ArrayList<>(playlist.header());
        raiseVersion(header);
        header.add("#EXT-X-SKIP:SKIPPED-SEGMENTS=" + firstRetainedIndex);
        // 생략 구간에 있던 MAP/KEY는 뒤 세그먼트에도 적용되므로 살려 옮긴다(RFC 8216bis §6.2.5.1).
        // 현재 Egress 출력(TS·비암호화)엔 없지만 fMP4·암호화로 바뀌면 이게 없으면 조용히 깨진다.
        carryForwardAppliedTags(segments.subList(0, firstRetainedIndex), header);

        return playlist
                .withHeader(header)
                .withSegments(segments.subList(firstRetainedIndex, segments.size()))
                .render();
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

    /** {@code EXT-X-VERSION}을 델타 최소 버전으로 끌어올린다. 태그가 없으면 새로 넣는다. */
    private void raiseVersion(List<String> header) {
        for (int i = 0; i < header.size(); i++) {
            String trimmed = header.get(i).strip();
            if (trimmed.startsWith(VERSION_TAG)) {
                int current = parseIntOrDefault(trimmed.substring(VERSION_TAG.length()), 1);
                if (current < DELTA_MIN_VERSION) {
                    header.set(i, VERSION_TAG + DELTA_MIN_VERSION);
                }
                return;
            }
        }
        int insertAt = header.size() > 0 && header.get(0).strip().startsWith("#EXTM3U") ? 1 : 0;
        header.add(insertAt, VERSION_TAG + DELTA_MIN_VERSION);
    }

    /** 생략 구간의 마지막 MAP/KEY만 헤더로 옮긴다 — 뒤 세그먼트에 계속 적용되는 태그다. */
    private void carryForwardAppliedTags(List<Segment> skipped, List<String> header) {
        String lastMap = null;
        String lastKey = null;
        for (Segment segment : skipped) {
            for (String line : segment.lines()) {
                String trimmed = line.strip();
                if (trimmed.startsWith("#EXT-X-MAP:")) {
                    lastMap = line;
                } else if (trimmed.startsWith("#EXT-X-KEY:")) {
                    lastKey = line;
                }
            }
        }
        if (lastMap != null) {
            header.add(lastMap);
        }
        if (lastKey != null) {
            header.add(lastKey);
        }
    }

    private int parseIntOrDefault(String value, int fallback) {
        try {
            return Integer.parseInt(value.strip());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** {@code CAN-SKIP-UNTIL}은 소수 초 표기다. 정수면 소수점을 붙이지 않는다. */
    private String formatSeconds(Duration duration) {
        long millis = duration.toMillis();
        return millis % 1000 == 0
                ? Long.toString(millis / 1000)
                : String.valueOf(millis / 1000.0);
    }

    /**
     * 재생목록을 헤더 / 세그먼트 블록 / 트레일러로 나눈 표현.
     *
     * <p>세그먼트 블록 = 그 세그먼트에만 붙는 선행 태그들({@code EXTINF}·{@code PDT} 등) + URI 한 줄.
     * 델타는 이 블록 단위로 앞에서부터 들어낸다. 헤더는 재생목록 전체에 적용되는 태그라 보존한다.
     */
    private record Playlist(List<String> header, List<Segment> segments, List<String> trailer) {

        static Playlist parse(String manifest) {
            List<String> header = new ArrayList<>();
            List<Segment> segments = new ArrayList<>();
            List<String> pending = new ArrayList<>();
            List<String> trailer = new ArrayList<>();
            boolean seenSegment = false;

            for (String line : manifest.split("\\R", -1)) {
                String trimmed = line.strip();
                boolean isUri = !trimmed.isEmpty() && !trimmed.startsWith("#");
                if (isUri) {
                    pending.add(line);
                    segments.add(Segment.of(pending));
                    pending = new ArrayList<>();
                    seenSegment = true;
                } else if (trimmed.startsWith(EXTINF_TAG) || trimmed.startsWith(PDT_TAG)
                        || trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-KEY:")
                        || trimmed.startsWith("#EXT-X-DISCONTINUITY")) {
                    pending.add(line);
                } else if (seenSegment && (trimmed.startsWith(ENDLIST_TAG) || trimmed.isEmpty())) {
                    trailer.add(line);
                } else if (seenSegment) {
                    trailer.add(line);
                } else {
                    header.add(line);
                }
            }
            // URI를 못 만난 잔여 태그는 트레일러로 흘려 원문 손실을 막는다.
            trailer.addAll(0, pending);
            return new Playlist(header, segments, trailer);
        }

        Playlist withHeader(List<String> newHeader) {
            return new Playlist(newHeader, segments, trailer);
        }

        Playlist withSegments(List<Segment> newSegments) {
            return new Playlist(header, newSegments, trailer);
        }

        String render() {
            List<String> out = new ArrayList<>(header);
            segments.forEach(segment -> out.addAll(segment.lines()));
            out.addAll(trailer);
            return String.join("\n", out);
        }
    }

    /** 세그먼트 하나를 이루는 줄들과 그 길이. */
    private record Segment(List<String> lines, double durationSeconds) {

        static Segment of(List<String> lines) {
            double seconds = 0;
            for (String line : lines) {
                String trimmed = line.strip();
                if (trimmed.startsWith(EXTINF_TAG)) {
                    seconds = parseExtinf(trimmed);
                }
            }
            return new Segment(List.copyOf(lines), seconds);
        }

        private static double parseExtinf(String line) {
            String value = line.substring(EXTINF_TAG.length());
            int comma = value.indexOf(',');
            if (comma >= 0) {
                value = value.substring(0, comma);
            }
            try {
                return Double.parseDouble(value.strip());
            } catch (NumberFormatException e) {
                return 0;
            }
        }
    }

    public record ManifestSnapshot(
            Long sessionOffsetMs,
            long totalDurationMs,
            long availableFromMs,
            long availableToMs
    ) {
    }
}

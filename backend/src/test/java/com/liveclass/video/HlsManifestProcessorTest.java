package com.liveclass.video;

import com.liveclass.video.service.HlsManifestProcessor;
import com.liveclass.video.service.ReplayManifestInvalidException;
import com.liveclass.video.service.ReplayStorage;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HlsManifestProcessorTest {

    private final ReplayStorage replayStorage = mock(ReplayStorage.class);
    private final HlsManifestProcessor processor = new HlsManifestProcessor(replayStorage);

    @Test
    void analyzes_pdt_and_extinf_as_session_relative_range() {
        String manifest = """
                #EXTM3U
                #EXT-X-PROGRAM-DATE-TIME:2026-07-27T10:00:02.500Z
                #EXTINF:2.0,
                seg0.ts
                #EXTINF:2.25,
                seg1.ts
                """;

        var snapshot = processor.analyze(
                manifest, OffsetDateTime.parse("2026-07-27T10:00:00Z"));

        assertThat(snapshot.sessionOffsetMs()).isEqualTo(2_500L);
        assertThat(snapshot.totalDurationMs()).isEqualTo(4_250L);
        assertThat(snapshot.availableFromMs()).isEqualTo(2_500L);
        assertThat(snapshot.availableToMs()).isEqualTo(6_750L);
    }

    @Test
    void malformed_optional_timing_degrades_without_blocking_manifest() {
        String manifest = """
                #EXTM3U
                #EXT-X-PROGRAM-DATE-TIME:not-a-date
                #EXTINF:not-a-number,
                seg0.ts
                """;

        var snapshot = processor.analyze(manifest, OffsetDateTime.now());

        assertThat(snapshot.sessionOffsetMs()).isNull();
        assertThat(snapshot.totalDurationMs()).isZero();
        assertThat(snapshot.availableFromMs()).isZero();
        assertThat(snapshot.availableToMs()).isZero();
    }

    @Test
    void rewrites_relative_segments_map_and_key_from_manifest_directory() {
        when(replayStorage.presignSegment(
                eq("recordings"), any(String.class), any(Duration.class)))
                .thenAnswer(invocation -> "https://minio/" + invocation.getArgument(1) + "?signed");
        String manifest = """
                #EXTM3U
                #EXT-X-MAP:URI="./init.mp4"
                #EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"
                #EXTINF:2.0,
                ./segments/seg0.m4s
                """;

        String rewritten = processor.rewrite(
                manifest,
                "recordings",
                "sessions/session-id/index.m3u8",
                Duration.ofHours(1));

        assertThat(rewritten)
                .contains("https://minio/sessions/session-id/init.mp4?signed")
                .contains("https://minio/sessions/session-id/keys/key.bin?signed")
                .contains("https://minio/sessions/session-id/segments/seg0.m4s?signed")
                .doesNotContain("URI=\"./init.mp4\"");
    }

    @Test
    void rejects_uri_that_escapes_manifest_directory() {
        assertThatThrownBy(() -> processor.rewrite(
                "#EXTM3U\n#EXTINF:2.0,\n../secret.ts\n",
                "recordings",
                "sessions/session-id/index.m3u8",
                Duration.ofHours(1)))
                .isInstanceOf(ReplayManifestInvalidException.class);
    }

    // --- 델타 재생목록 ---

    /** 세그먼트 n개짜리 라이브 재생목록(ENDLIST 없음). 각 2초. */
    private static String livePlaylist(int segments) {
        StringBuilder sb = new StringBuilder("""
                #EXTM3U
                #EXT-X-VERSION:3
                #EXT-X-TARGETDURATION:2
                #EXT-X-MEDIA-SEQUENCE:0
                #EXT-X-PROGRAM-DATE-TIME:2026-07-27T10:00:00.000Z
                """);
        for (int i = 0; i < segments; i++) {
            sb.append("#EXTINF:2.0,\n").append(String.format("seg_%05d.ts%n", i));
        }
        return sb.toString();
    }

    @Test
    void live_playlist_is_detected_by_absence_of_endlist() {
        assertThat(processor.isLive(livePlaylist(3))).isTrue();
        assertThat(processor.isLive(livePlaylist(3) + "#EXT-X-ENDLIST\n")).isFalse();
    }

    @Test
    void server_control_advertises_skip_and_raises_version_to_nine() {
        String out = processor.withServerControl(livePlaylist(3), Duration.ofSeconds(60));

        assertThat(out)
                .contains("#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=60")
                .contains("#EXT-X-VERSION:9")      // EXT-X-SKIP은 버전 9 이상을 요구한다
                .doesNotContain("#EXT-X-VERSION:3")
                .contains("seg_00000.ts");         // 세그먼트는 그대로
    }

    @Test
    void skip_replaces_old_segments_and_keeps_media_sequence() {
        // 100개 × 2초 = 200초. 경계 60초 → 뒤 30개만 남고 70개가 생략된다.
        String out = processor.skip(livePlaylist(100), Duration.ofSeconds(60));

        assertThat(out)
                .contains("#EXT-X-SKIP:SKIPPED-SEGMENTS=70")
                .contains("#EXT-X-MEDIA-SEQUENCE:0")   // ★ 생략은 삭제가 아니다 — 시작점 불변
                .doesNotContain("seg_00069.ts")
                .contains("seg_00070.ts")
                .contains("seg_00099.ts");
        assertThat(out.lines().filter(l -> l.startsWith("seg_")).count()).isEqualTo(30);
    }

    @Test
    void skip_returns_original_when_nothing_is_older_than_boundary() {
        String manifest = livePlaylist(5);   // 10초 < 경계 60초

        assertThat(processor.skip(manifest, Duration.ofSeconds(60)))
                .isEqualTo(manifest)
                .doesNotContain("#EXT-X-SKIP");
    }

    @Test
    void skip_carries_forward_map_and_key_that_still_apply() {
        String manifest = """
                #EXTM3U
                #EXT-X-VERSION:7
                #EXT-X-TARGETDURATION:2
                #EXT-X-MAP:URI="init.mp4"
                #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
                #EXTINF:2.0,
                seg_00000.m4s
                #EXTINF:2.0,
                seg_00001.m4s
                #EXTINF:2.0,
                seg_00002.m4s
                """;

        String out = processor.skip(manifest, Duration.ofSeconds(2));

        // 생략 구간에 있던 MAP/KEY는 남은 세그먼트에도 적용되므로 사라지면 안 된다.
        assertThat(out)
                .contains("#EXT-X-SKIP:SKIPPED-SEGMENTS=2")
                .contains("#EXT-X-MAP:URI=\"init.mp4\"")
                .contains("#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"")
                .contains("seg_00002.m4s")
                .doesNotContain("seg_00000.m4s");
    }

    @Test
    void skipped_playlist_only_presigns_retained_segments() {
        when(replayStorage.presignSegment(eq("recordings"), any(String.class), any(Duration.class)))
                .thenAnswer(invocation -> "https://minio/" + invocation.getArgument(1) + "?signed");

        String skipped = processor.skip(livePlaylist(100), Duration.ofSeconds(60));
        String out = processor.rewrite(
                skipped, "recordings", "sessions/s/index.m3u8", Duration.ofHours(1));

        // 3600엔트리를 매번 서명하지 않는 것이 델타의 요점이다.
        verify(replayStorage, times(30))
                .presignSegment(eq("recordings"), any(String.class), any(Duration.class));
        assertThat(out).contains("#EXT-X-SKIP:SKIPPED-SEGMENTS=70");
    }
}

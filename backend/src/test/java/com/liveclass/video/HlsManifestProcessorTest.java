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
}

package com.liveclass.video.service;

import com.liveclass.aiintegration.api.RagAnswerRelay;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.aiintegration.api.ReplayRagAnswerStreaming;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.PlaybackAccessGrant;
import com.liveclass.video.domain.RecordedCaptionPublicationStatus;
import com.liveclass.video.domain.RecordedCaptionSegment;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedCaptionTrack;
import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedCaptionSegmentRepository;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RecordedAiAnswerServiceTest {

    @Test
    void prepare_resolves_server_ids_and_uses_recorded_video_id_as_replay_session_id() {
        UUID userId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID videoId = UUID.randomUUID();
        UUID trackId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        RecordedVideo video = new RecordedVideo();
        video.setId(videoId);
        video.setLessonId(lessonId);
        video.setStatus(RecordedVideoStatus.READY);
        video.setPublicationStatus(RecordedPublicationStatus.PUBLISHED);
        video.setDurationMs(60_000L);
        RecordedCaptionTrack track = new RecordedCaptionTrack();
        track.setId(trackId);
        track.setRecordedVideoId(videoId);
        track.setStatus(RecordedCaptionStatus.READY);
        track.setPublicationStatus(RecordedCaptionPublicationStatus.PUBLISHED);
        track.setActiveJobId(jobId);

        RecordedVideoRepository videos = mock(RecordedVideoRepository.class);
        RecordedCaptionTrackRepository tracks = mock(RecordedCaptionTrackRepository.class);
        RecordedCaptionSegmentRepository segments = mock(RecordedCaptionSegmentRepository.class);
        LessonPlaybackAccess access = mock(LessonPlaybackAccess.class);
        ReplayRagAnswerStreaming streaming = mock(ReplayRagAnswerStreaming.class);
        when(streaming.streamTimeout()).thenReturn(Duration.ofSeconds(30));
        when(access.resolve(userId, lessonId)).thenReturn(new PlaybackAccessGrant(false, curriculumId));
        when(videos.findByLessonId(lessonId)).thenReturn(java.util.Optional.of(video));
        when(tracks.findByRecordedVideoId(videoId)).thenReturn(java.util.Optional.of(track));
        when(segments.findContextSegments(trackId, jobId, 25_000L, 55_000L))
                .thenReturn(List.of(segment(50_000L, 54_000L, "질문 직전 자막")));
        RecordedAiAnswerService service = new RecordedAiAnswerService(videos, tracks, segments, access, streaming, mock(RagAnswerRelay.class));

        ReplayRagAnswerCommand command = service.prepare(userId, lessonId, "질문", 55_000L);

        assertThat(command.lessonId()).isEqualTo(lessonId);
        assertThat(command.curriculumId()).isEqualTo(curriculumId);
        assertThat(command.sessionId()).isEqualTo(videoId);
        assertThat(command.questionSessionMs()).isEqualTo(55_000L);
        assertThat(command.captions()).singleElement().satisfies(caption -> {
            assertThat(caption.sttSessionId()).isEqualTo(jobId.toString());
            assertThat(caption.startSessionMs()).isEqualTo(50_000L);
            assertThat(caption.endSessionMs()).isEqualTo(54_000L);
        });
    }

    @Test
    void caption_adapter_keeps_the_nearest_twenty_segments_in_time_order() {
        UUID jobId = UUID.randomUUID();
        List<RecordedCaptionSegment> candidates = new ArrayList<>();
        for (int index = 0; index < 25; index++) {
            candidates.add(segment(index * 1_000L, index * 1_000L + 900L, "segment-" + index));
        }

        List<ReplayRagAnswerCommand.Caption> result =
                RecordedAiAnswerService.adaptCaptions(jobId, candidates);

        assertThat(result).hasSize(20);
        assertThat(result.getFirst().text()).isEqualTo("segment-5");
        assertThat(result.getLast().text()).isEqualTo("segment-24");
        assertThat(result).extracting(ReplayRagAnswerCommand.Caption::segmentIndex)
                .containsExactlyElementsOf(java.util.stream.IntStream.range(0, 20).boxed().toList());
        assertThat(result).allMatch(caption -> caption.sttSessionId().equals(jobId.toString()));
    }

    @Test
    void caption_adapter_never_exceeds_the_six_thousand_character_budget() {
        UUID jobId = UUID.randomUUID();
        List<RecordedCaptionSegment> candidates = List.of(
                segment(0, 1_000, "a".repeat(4_000)),
                segment(1_000, 2_000, "b".repeat(4_000)));

        List<ReplayRagAnswerCommand.Caption> result =
                RecordedAiAnswerService.adaptCaptions(jobId, candidates);

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().text()).hasSize(4_000);
        assertThat(result.stream().mapToInt(caption -> caption.text().length()).sum()).isLessThanOrEqualTo(6_000);
    }

    @Test
    void a_single_oversized_nearest_segment_is_trimmed_to_the_budget() {
        List<ReplayRagAnswerCommand.Caption> result = RecordedAiAnswerService.adaptCaptions(
                UUID.randomUUID(), List.of(segment(10_000, 20_000, "x".repeat(7_000))));

        assertThat(result).singleElement().satisfies(caption -> {
            assertThat(caption.startSessionMs()).isEqualTo(10_000);
            assertThat(caption.endSessionMs()).isEqualTo(20_000);
            assertThat(caption.text()).hasSize(6_000);
        });
    }

    private RecordedCaptionSegment segment(long startMs, long endMs, String text) {
        RecordedCaptionSegment segment = new RecordedCaptionSegment();
        segment.setStartMs(startMs);
        segment.setEndMs(endMs);
        segment.setText(text);
        return segment;
    }
}

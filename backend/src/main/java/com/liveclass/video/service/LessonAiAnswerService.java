package com.liveclass.video.service;

import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.lesson.api.LessonDetailView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.video.api.PlaybackAccessException;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/**
 * 레슨 AI 질문의 단일 진입점(ADR-0015 · ADR-0075). 브라우저는 레슨 하나만 알고,
 * <b>근거를 어디서 가져올지는 여기서 갈린다.</b>
 *
 * <p>갈림길은 {@code lesson.deliveryType} 하나다 — 한 레슨은 업로드 녹화강의({@code RECORDED})이거나
 * 라이브({@code LIVE})이지 둘 다일 수 없다. 그래서 "이 레슨에 어떤 자산이 있나" 뒤져 추측하지 않는다.
 *
 * <ul>
 *   <li>{@code RECORDED} — 업로드 영상의 {@code recorded_caption_segment}. 자막 시간축이 곧 플레이어 축이다.</li>
 *   <li>{@code LIVE} — 라이브 세션 녹화(Egress)의 {@code live_caption}. attempt 앵커를 적용해야 세션 축이 된다.</li>
 * </ul>
 *
 * <p>두 갈래는 ai-api Replay v2 <b>같은 wire</b>로 나가고 SSE 중계도 같다. 다른 것은 자막 출처와,
 * 답변을 기록하는지 여부뿐이다(LIVE만 라이브 질문과 같은 표에 쌓는다 — RECORDED에는 세션이 없다).
 */
@Service
public class LessonAiAnswerService {

    private static final String DELIVERY_RECORDED = "RECORDED";

    private final LessonDirectory lessonDirectory;
    private final RecordedAiAnswerService recordedAiAnswerService;
    private final ReplayAiAnswerService replayAiAnswerService;

    public LessonAiAnswerService(LessonDirectory lessonDirectory,
                                 RecordedAiAnswerService recordedAiAnswerService,
                                 ReplayAiAnswerService replayAiAnswerService) {
        this.lessonDirectory = lessonDirectory;
        this.recordedAiAnswerService = recordedAiAnswerService;
        this.replayAiAnswerService = replayAiAnswerService;
    }

    /**
     * 질문 한 건을 알맞은 갈래로 보내고 SSE를 돌려준다.
     *
     * <p>인가는 각 갈래의 {@code prepare}가 한다 — 실패하면 ai-api를 부르지 않는다(비용·근거 유출 방지).
     * 여기서는 레슨 존재만 확인한다: 없는 레슨은 {@code NOT_FOUND}로 은닉한다.
     */
    public SseEmitter ask(UUID userId, UUID lessonId, String question, long playbackMs) {
        if (isRecorded(lessonId)) {
            ReplayRagAnswerCommand command =
                    recordedAiAnswerService.prepare(userId, lessonId, question, playbackMs);
            RagAnswerStreamHandle handle = recordedAiAnswerService.open(command);
            return recordedAiAnswerService.relay(command, handle);
        }
        ReplayRagAnswerCommand command =
                replayAiAnswerService.prepare(userId, lessonId, question, playbackMs);
        RagAnswerStreamHandle handle = replayAiAnswerService.open(command);
        return replayAiAnswerService.relay(command, handle, userId);
    }

    private boolean isRecorded(UUID lessonId) {
        return lessonDirectory.findDetail(lessonId)
                .map(LessonDetailView::deliveryType)
                .map(DELIVERY_RECORDED::equals)
                .orElseThrow(() -> new PlaybackAccessException(
                        PlaybackAccessException.Reason.NOT_FOUND, "강의를 찾을 수 없습니다."));
    }
}

package com.liveclass.live.service;

import com.liveclass.aiintegration.api.RagAnswerCommand;
import com.liveclass.aiintegration.api.RagSseEvent;
import com.liveclass.live.domain.LiveAiAnswer;
import com.liveclass.live.repository.LiveAiAnswerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 흘러가는 답변을 옆에서 받아 적었다가 스트림이 끝날 때 한 번 저장한다(ADR-0047 확장).
 *
 * <p><b>중계를 방해하지 않는다.</b> 여기서 예외가 나도 브라우저로 가는 SSE는 그대로 흘러야 한다 —
 * 기록은 편의이고 답변은 기능이다. 그래서 모든 실패를 삼키고 로그만 남긴다.
 *
 * <p><b>data를 여기서만 읽는다.</b> 릴레이는 ai-api 프레임을 파싱하지 않고 그대로 넘기는 것이 계약인데
 * (ADR-0047), 저장하려면 텍스트를 꺼내야 한다. 파싱을 이 클래스에 가둬 릴레이 경로는 그대로 둔다.
 */
@Service
public class LiveAiAnswerRecorder {

    private static final Logger log = LoggerFactory.getLogger(LiveAiAnswerRecorder.class);

    /** 한 답변이 이보다 길어지면 더 모으지 않는다. 저장은 복구용이고 무한정 힙을 쓸 이유가 없다. */
    private static final int MAX_ANSWER_CHARS = 100_000;

    private final LiveAiAnswerRepository repository;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public LiveAiAnswerRecorder(LiveAiAnswerRepository repository) {
        this.repository = repository;
    }

    /** 한 스트림의 기록을 시작한다. 호출자는 프레임마다 {@link Recording#observe}를 부르고 끝나면 {@link Recording#save}. */
    public Recording start(RagAnswerCommand command, UUID userId) {
        return new Recording(command, userId);
    }

    /**
     * 스트림 하나의 누적. 릴레이 스레드 하나만 만지므로 동기화하지 않는다.
     */
    public final class Recording {

        private final RagAnswerCommand command;
        private final UUID userId;
        private final StringBuilder answer = new StringBuilder();
        private String status;
        private String sources = "[]";
        private String failureCode;

        private Recording(RagAnswerCommand command, UUID userId) {
            this.command = command;
            this.userId = userId;
        }

        /** 프레임 하나를 받아 적는다. 실패해도 중계를 막지 않는다. */
        public void observe(RagSseEvent event) {
            try {
                switch (event.name()) {
                    case "answer.delta" -> appendDelta(event.data());
                    case "answer.done" -> {
                        status = "DONE";
                        sources = readSources(event.data());
                    }
                    case "answer.insufficient" -> status = "INSUFFICIENT";
                    case "answer.error" -> {
                        status = "ERROR";
                        failureCode = readText(event.data(), "code");
                    }
                    default -> { /* 모르는 이벤트는 기록하지 않는다 — 중계는 그대로 나간다 */ }
                }
            } catch (RuntimeException e) {
                log.debug("AI 답변 기록 중 프레임 해석 실패 requestId={}: {}", command.requestId(), e.toString());
            }
        }

        /**
         * 스트림이 끝났다. 한 번만 저장한다.
         *
         * <p>terminal을 못 본 채 끊긴 경우도 남긴다 — 그때까지 받은 답변이 사라지면 사용자는 화면을
         * 새로고침했다는 이유만으로 읽던 것을 잃는다.
         */
        @Transactional
        public void save() {
            try {
                if (repository.existsByRequestId(command.requestId())) {
                    return;   // 같은 스트림을 두 번 저장하지 않는다
                }
                LiveAiAnswer row = new LiveAiAnswer();
                row.setRequestId(command.requestId());
                row.setSessionId(command.sessionId());
                row.setLessonId(command.lessonId());
                row.setUserId(userId);
                row.setQuestion(command.question());
                row.setAnswer(answer.toString());
                row.setSources(sources);
                row.setStatus(status == null ? "ERROR" : status);
                row.setFailureCode(status == null ? "PROXY_STREAM_INCOMPLETE" : failureCode);
                row.setAskedAt(OffsetDateTime.now());
                repository.save(row);
            } catch (RuntimeException e) {
                // 기록 실패가 답변을 망치면 안 된다. 이미 브라우저는 답을 다 받았다.
                log.warn("AI 답변 기록 실패(무시) requestId={}: {}", command.requestId(), e.toString());
            }
        }

        private void appendDelta(String data) {
            if (answer.length() >= MAX_ANSWER_CHARS) {
                return;
            }
            String text = readText(data, "text");
            if (text != null) {
                answer.append(text);
            }
        }

        private String readText(String data, String field) {
            JsonNode node = jsonMapper.readTree(data).path(field);
            return node.isMissingNode() || node.isNull() ? null : node.asString();
        }

        /** 근거는 해석하지 않고 배열 그대로 옮긴다. */
        private String readSources(String data) {
            JsonNode node = jsonMapper.readTree(data).path("sources");
            return node.isArray() ? node.toString() : "[]";
        }
    }
}

package com.liveclass.admin.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.curriculum.api.CurriculumDirectory;
import com.liveclass.curriculum.api.CurriculumView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.live.api.LiveRecordingStatus;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 운영자가 세션 하나를 판단하는 데 필요한 것을 한 번에 모은다(ADR-0089).
 *
 * <p><b>강사 화면을 열어 주는 대신 이것을 만들었다.</b> ADMIN은 도메인 게이트를 통과하지 않고,
 * 통과시키려면 게이트 15개 파일·37개 호출부에 우회를 넣어야 한다 — 어느 강의인지 알기 위해 인가
 * 축을 전면 변경할 일이 아니다. 필요한 값만 모아 <b>읽기 전용</b>으로 보여 주면 게이트를 건드리지
 * 않고도 판단에 필요한 것이 다 나온다.
 *
 * <p>새로 만든 포트가 없다. 전부 이미 있는 것을 조합한다 — 세션은 {@code LiveSessionDirectory},
 * 녹화는 {@code LiveRecordingStatus}(live가 선언하고 video가 구현한다), 제목은 lesson·curriculum,
 * 강사 이름은 auth. 그래서 이 모듈이 커져도 도메인 모듈은 그대로다.
 *
 * <p><b>이메일은 담지 않는다.</b> 운영자가 "누구 수업인가"를 알려면 표시 이름으로 충분하고,
 * PII는 필요할 때만 꺼내는 것이 규칙이다({@code UserDirectory.findContacts}가 따로 있는 이유).
 */
@Service
public class SessionDetailService {

    private final LiveSessionDirectory liveSessionDirectory;
    private final LiveRecordingStatus recordingStatus;
    private final LessonDirectory lessonDirectory;
    private final CurriculumDirectory curriculumDirectory;
    private final UserDirectory userDirectory;

    public SessionDetailService(LiveSessionDirectory liveSessionDirectory,
                                LiveRecordingStatus recordingStatus,
                                LessonDirectory lessonDirectory,
                                CurriculumDirectory curriculumDirectory,
                                UserDirectory userDirectory) {
        this.liveSessionDirectory = liveSessionDirectory;
        this.recordingStatus = recordingStatus;
        this.lessonDirectory = lessonDirectory;
        this.curriculumDirectory = curriculumDirectory;
        this.userDirectory = userDirectory;
    }

    /**
     * @return 세션이 없으면 빈 값. 화면이 "이미 지워진 세션"이라고 말할 수 있어야 한다 — 유령
     *         Egress를 쫓아 들어오면 실제로 그런 경우가 있다.
     */
    @Transactional(readOnly = true)
    public Optional<SessionDetail> findBySessionId(UUID sessionId) {
        return liveSessionDirectory.findById(sessionId).map(session -> {
            Optional<CurriculumView> curriculum = liveSessionDirectory.findCurriculumId(sessionId)
                    .flatMap(curriculumDirectory::findById);
            String lessonTitle = session.lessonId() == null ? null
                    : lessonDirectory.findTitles(List.of(session.lessonId())).get(session.lessonId());
            Optional<UserView> instructor = session.instructorId() == null
                    ? Optional.empty()
                    : userDirectory.findById(session.instructorId());

            return new SessionDetail(
                    session.sessionId(),
                    // 방 이름 규약은 video·live가 공유한다. 운영자가 LiveKit 콘솔에서 찾을 때 쓰는 값이다.
                    "session-" + session.sessionId(),
                    session.liveSessionStatus(),
                    session.roomSid(),
                    session.scheduledAt(),
                    session.startedAt(),
                    session.endedAt(),
                    new Features(session.recordingEnabled(), session.captionEnabled(),
                            session.chatEnabled(), session.aiQnaEnabled()),
                    session.lessonId(),
                    lessonTitle,
                    curriculum.map(CurriculumView::curriculumId).orElse(null),
                    curriculum.map(CurriculumView::title).orElse(null),
                    session.instructorId(),
                    instructor.map(UserView::displayName).orElse(null),
                    recordingStatus.findBySession(sessionId).map(Recording::from).orElse(null));
        });
    }

    /**
     * @param roomName        LiveKit 방 이름. 운영자가 저쪽 콘솔·로그에서 찾을 때 쓰는 값이다
     * @param recording       녹화 자산. 아직 만들어지지 않았거나 녹화를 안 켠 세션이면 {@code null}
     */
    public record SessionDetail(
            UUID sessionId,
            String roomName,
            String status,
            String roomSid,
            OffsetDateTime scheduledAt,
            OffsetDateTime startedAt,
            OffsetDateTime endedAt,
            Features features,
            UUID lessonId,
            String lessonTitle,
            UUID curriculumId,
            String curriculumTitle,
            UUID instructorId,
            String instructorName,
            Recording recording) {
    }

    /** 세션이 무엇을 켜고 시작했는가. 자막이 없다는 문의가 왔을 때 제일 먼저 볼 값이다. */
    public record Features(boolean recording, boolean caption, boolean chat, boolean aiQna) {
    }

    public record Recording(
            UUID videoAssetId,
            String status,
            String replayStatus,
            String failureCode,
            Long durationMs,
            Long sizeBytes,
            OffsetDateTime startedAt,
            OffsetDateTime endedAt) {

        static Recording from(LiveRecordingStatus.RecordingStatusView view) {
            return new Recording(view.videoAssetId(), view.status(), view.replayStatus(),
                    view.failureCode(), view.durationMs(), view.sizeBytes(),
                    view.recordingStartedAt(), view.recordingEndedAt());
        }
    }
}

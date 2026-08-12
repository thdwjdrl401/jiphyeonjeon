package com.liveclass.admin.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.learning.api.LearningDirectory;
import com.liveclass.learning.api.RecentWatcherView;
import com.liveclass.live.api.LivePresenceDirectory;
import com.liveclass.live.api.LivePresentUser;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 세션 하나를 <b>지금 누가 보고 있는가</b>(ADR-0121).
 *
 * <p>운영 콘솔은 Egress와 LiveKit만 볼 수 있었다. 둘 다 <b>기계</b>의 상태라, "수업이 도는가"는
 * 알려 줘도 "듣는 사람이 있는가"는 답하지 못한다. 강사가 혼자 말하고 있는 세션과 30명이 듣는 세션이
 * 화면에서 똑같이 보였다.
 *
 * <p><b>두 신호를 합친다. 둘은 다른 것을 말한다.</b>
 * <ul>
 *   <li><b>라이브 접속자</b> — STOMP 구독 집계({@code LivePresenceDirectory}). 지금 강의실을 열어 둔
 *       사람이다. LiveKit {@code listParticipants}로는 이걸 못 본다 — 수강생은 HLS로만 보고 방에
 *       들어오지 않아(ADR-0032) 저쪽에는 강사·Egress·STT 에이전트만 잡힌다.
 *   <li><b>다시보기 시청자</b> — 시청 보고({@code LearningDirectory}). 라이브가 끝난 뒤에도, 아니
 *       끝난 뒤가 대부분인 시청이다.
 * </ul>
 *
 * <p><b>새 계측을 만들지 않았다.</b> 둘 다 이미 서버에 도착하고 있던 신호이고, 노출만 되지 않았다.
 * "지금 뭘 보는지"를 알려고 클라이언트에 하트비트를 새로 심으면, 이미 15초마다 오고 있는 보고 위에
 * 같은 뜻의 트래픽을 하나 더 얹는 것이 된다.
 *
 * <p><b>이름만 붙이고 이메일은 담지 않는다.</b> 운영자가 "누가 듣고 있나"를 알려면 표시 이름으로
 * 충분하다({@code SessionDetailService}가 강사 이름에 대해 같은 규칙을 쓴다).
 */
@Service
public class SessionViewerService {

    /**
     * "방금까지 보고 있었다"의 길이. 클라이언트 보고 주기가 15초라(useWatchTracking) 그 네 배로 둔다 —
     * 한 번 놓쳐도 목록에서 사라지지 않고, 창을 닫은 사람은 1분 안에 빠진다.
     *
     * <p>더 짧게 잡으면 보고 한 번을 놓친 사람이 깜빡이고, 더 길게 잡으면 나간 사람이 남아 "듣고
     * 있다"고 잘못 말한다.
     */
    static final Duration RECENT_WATCH_WINDOW = Duration.ofSeconds(60);

    private final LiveSessionDirectory liveSessionDirectory;
    private final LivePresenceDirectory presenceDirectory;
    private final LearningDirectory learningDirectory;
    private final UserDirectory userDirectory;

    public SessionViewerService(LiveSessionDirectory liveSessionDirectory,
                                LivePresenceDirectory presenceDirectory,
                                LearningDirectory learningDirectory,
                                UserDirectory userDirectory) {
        this.liveSessionDirectory = liveSessionDirectory;
        this.presenceDirectory = presenceDirectory;
        this.learningDirectory = learningDirectory;
        this.userDirectory = userDirectory;
    }

    /**
     * @return 세션이 없으면 빈 값. 상세 화면과 같은 규칙이다 — 주소로 직접 들어오는 화면이라
     *         "그런 세션 없음"을 분명히 말해야 한다
     */
    @Transactional(readOnly = true)
    public Optional<SessionViewers> findBySessionId(UUID sessionId) {
        return liveSessionDirectory.findById(sessionId).map(session -> {
            List<LivePresentUser> present = presenceDirectory.presentIn(sessionId);
            List<RecentWatcherView> watchers = recentWatchers(session);

            // 두 목록의 이름을 한 번에 받는다. 행마다 물으면 사람 수만큼 왕복이 생긴다.
            Set<UUID> userIds = new HashSet<>();
            present.forEach(p -> userIds.add(p.userId()));
            watchers.forEach(w -> userIds.add(w.userId()));
            Map<UUID, String> names = userDirectory.findDisplayNames(userIds);

            List<LiveViewer> live = new ArrayList<>();
            for (LivePresentUser p : present) {
                live.add(new LiveViewer(p.userId(), names.get(p.userId()), p.instructor(), p.since()));
            }
            List<ReplayViewer> replay = new ArrayList<>();
            for (RecentWatcherView w : watchers) {
                replay.add(new ReplayViewer(w.userId(), names.get(w.userId()),
                        w.lastPositionMs(), w.progressPercent(), w.lastReportedAt()));
            }
            return new SessionViewers(sessionId, live, replay,
                    (int) RECENT_WATCH_WINDOW.toSeconds());
        });
    }

    /**
     * 다시보기 시청은 <b>레슨</b>에 붙는다. 세션에 레슨이 없으면 물어볼 대상이 없다 — 그런 세션이
     * 실제로 있고(레슨 없이 만든 임시 세션), 그때 빈 목록은 "아무도 안 본다"가 아니라 "물어볼
     * 대상이 없다"는 뜻이다.
     */
    private List<RecentWatcherView> recentWatchers(LiveSessionView session) {
        if (session.lessonId() == null) {
            return List.of();
        }
        return learningDirectory.findRecentWatchers(
                session.lessonId(), OffsetDateTime.now().minus(RECENT_WATCH_WINDOW));
    }

    /**
     * @param recentWindowSeconds 다시보기 판정에 쓴 기준 창. 화면이 <b>같은 기준으로</b> 설명하도록
     *                            서버가 함께 준다({@code LiveSummary.stuckAfterHours}와 같은 규칙)
     */
    public record SessionViewers(
            UUID sessionId,
            List<LiveViewer> live,
            List<ReplayViewer> replay,
            int recentWindowSeconds) {
    }

    /**
     * 지금 라이브 강의실을 열어 둔 사람.
     *
     * @param displayName 못 찾으면 {@code null}. 탈퇴 등으로 사용자가 사라져도 <b>행은 남긴다</b> —
     *                    운영자가 보는 것은 "몇 명이 듣고 있나"이고, 이름 하나 때문에 인원이 틀리면 안 된다
     * @param instructor  강사인가. 시작은 됐는데 강사가 안 들어온 세션을 이 값으로 가른다
     */
    public record LiveViewer(UUID userId, String displayName, boolean instructor, OffsetDateTime since) {
    }

    /**
     * 방금까지 다시보기를 보고 있던 사람.
     *
     * @param lastPositionMs 마지막으로 보고된 재생 위치. 어디를 보고 있는지가 이 값이다
     */
    public record ReplayViewer(
            UUID userId,
            String displayName,
            long lastPositionMs,
            int progressPercent,
            OffsetDateTime lastReportedAt) {
    }
}

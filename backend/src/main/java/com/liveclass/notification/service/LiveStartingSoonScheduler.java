package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.domain.NotificationSchedule;
import com.liveclass.notification.repository.NotificationScheduleRepository;
import com.liveclass.live.api.LiveSessionDirectory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 발화 예정을 시각에 맞춰 아웃박스로 넘긴다(ADR-0073 §6).
 *
 * <p><b>이 폴링이 하는 일은 아웃박스에 한 줄 넣는 것뿐이다.</b> 수신자를 훑지 않는다 — 그건 워커가
 * 커서로 나눠서 한다. 그래서 수강생이 100만 명이어도 이 잡의 비용은 그대로다.
 *
 * <p>처음 설계는 1분마다 "보낼 게 있나"를 조건으로 훑는 것이었는데, 그러면 조건이 한 번 참이 된 뒤
 * <b>강의 시작까지 매분 같은 삽입을 다시 시도한다</b>(리드타임 하루면 1,440번). {@code ON CONFLICT}가
 * 결과를 지켜 주므로 버그로 보이지도 않고 조용히 DB만 갈아먹는다. 예정 행에 {@code fired_at}을 두어
 * 한 번만 나가게 한 이유다.
 *
 * <p><b>단일 인스턴스 전제다.</b> 여러 대로 늘리면 같은 행을 두 인스턴스가 집어 아웃박스에 두 줄이
 * 들어갈 수 있다. 알림 자체는 {@code dedupe_key}가 막지만 헛일이 늘어난다 — 그때는 잠금이 필요하다.
 */
@Component
public class LiveStartingSoonScheduler {

    private static final Logger log = LoggerFactory.getLogger(LiveStartingSoonScheduler.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final NotificationScheduleRepository repository;
    private final LiveSessionDirectory liveSessionDirectory;
    private final WideFanoutPublisher wideFanout;
    private final int sliceLimit;

    public LiveStartingSoonScheduler(NotificationScheduleRepository repository,
                                     LiveSessionDirectory liveSessionDirectory,
                                     WideFanoutPublisher wideFanout,
                                     @Value("${notification.fanout.slice-size:1000}") int sliceLimit) {
        this.repository = repository;
        this.liveSessionDirectory = liveSessionDirectory;
        this.wideFanout = wideFanout;
        this.sliceLimit = sliceLimit;
    }

    @Scheduled(fixedDelayString = "${notification.live-starting-soon.poll-ms:30000}",
            initialDelayString = "${notification.live-starting-soon.initial-delay-ms:20000}")
    @Transactional
    public void fireDue() {
        OffsetDateTime now = OffsetDateTime.now();
        List<NotificationSchedule> due =
                repository.findTop100ByFiredAtIsNullAndFireAtLessThanEqualOrderByFireAtAsc(now);
        for (NotificationSchedule schedule : due) {
            fire(schedule, now);
        }
    }

    private void fire(NotificationSchedule schedule, OffsetDateTime now) {
        // 어떤 경우에도 이 행은 끝난 것으로 표시한다. 실패든 건너뜀이든 매 주기 다시 집으면 안 된다.
        schedule.setFiredAt(now);

        /*
         * 발화가 밀렸으면 보내지 않는다. 배포·장애로 폴링이 멈춘 사이 시작 시각까지 지나갔다면
         * "곧 시작합니다"는 거짓이다 — 이미 하고 있거나 끝난 라이브다.
         */
        if (schedule.getStartsAt().isBefore(now)) {
            log.warn("곧 시작 알림 시점을 놓쳐 건너뜀 session={} startsAt={}",
                    schedule.getLiveSessionId(), schedule.getStartsAt());
            return;
        }

        var session = liveSessionDirectory.findById(schedule.getLiveSessionId()).orElse(null);
        var curriculumId = liveSessionDirectory.findCurriculumId(schedule.getLiveSessionId()).orElse(null);
        if (session == null || curriculumId == null) {
            log.warn("세션이 사라져 곧 시작 알림 건너뜀 session={}", schedule.getLiveSessionId());
            return;
        }

        NotificationFanoutCommand command = NotificationFanoutCommand.forLiveSchedule(
                NotificationTypes.LIVE_STARTING_SOON, curriculumId, session.lessonId(),
                schedule.getLiveSessionId(), null, schedule.getStartsAt(), now, sliceLimit,
                schedule.getLeadMinutes());

        wideFanout.publish(command, "live_session", schedule.getLiveSessionId().toString(),
                // 시작 시각이 키에 들어간다 — 일정이 바뀌면 새 회차이므로 다시 알려야 한다.
                // 리드타임이 키에 들어간다 — 같은 세션의 5분 전과 30분 전은 다른 발화다.
                "notif:LIVE_STARTING_SOON:" + schedule.getLiveSessionId()
                        + ':' + schedule.getLeadMinutes()
                        + ':' + schedule.getStartsAt().toInstant().toEpochMilli());
        log.info("곧 시작 알림 예약 발화 session={} startsAt={}",
                schedule.getLiveSessionId(), schedule.getStartsAt());
    }
}

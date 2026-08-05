package com.liveclass.notification.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 알림을 <b>누른 시점</b>의 대상 상태(CONTRACT §2-4, ADR-0073 §8).
 *
 * <p>만들 때가 아니라 누를 때 다시 판정하는 이유는, 그 사이에 커리큘럼이 지워지거나 수강이
 * 취소되거나 라이브가 취소될 수 있기 때문이다. 알림은 그때의 기록이고 이 판정은 지금의 사실이다.
 *
 * <p>대상이 사라져도 <b>정상 200에 {@code GONE}</b>을 준다. 404로 주면 화면이 "삭제된 강의입니다"와
 * "잠시 후 다시 시도해 주세요"를 구별하지 못한다.
 */
public sealed interface NotificationTargetResolution {

    /** 아직 볼 수 있다. 어디로 갈지는 화면이 {@code type}과 이 상태로 계산한다. */
    record Available(State state) implements NotificationTargetResolution {
    }

    /** 더 이상 볼 수 없다. 이 판정과 함께 알림의 처리 축은 {@code EXPIRED}로 내려간다. */
    record Gone(String reasonCode) implements NotificationTargetResolution {
    }

    /** 대상이 사라졌거나 볼 수 없게 된 이유. 문구는 화면이 고른다. */
    final class Reason {

        /** 커리큘럼·강의·녹화본이 삭제됐다. */
        public static final String TARGET_DELETED = "TARGET_DELETED";
        /** 수강 취소·제적·강사 변경으로 열람 권한이 사라졌다. */
        public static final String ACCESS_REVOKED = "ACCESS_REVOKED";
        /** 처리 가능 기간이 지났다(취소된 라이브 등). */
        public static final String TARGET_EXPIRED = "TARGET_EXPIRED";

        private Reason() {
        }
    }

    /**
     * 화면이 목적지를 계산하는 데 쓰는 값들. <b>경로를 담지 않는다</b> — 경로가 바뀌면 서버도 같이
     * 고쳐야 하고, 화면이 자기 라우팅을 서버에서 받아 오는 구조가 된다.
     */
    record State(
            UUID curriculumId,
            /** 강의 상세 경로가 섹션을 요구한다. 레슨에서 거슬러 올라가 채운다. */
            UUID sectionId,
            UUID lessonId,
            UUID liveSessionId,
            UUID enrollmentId,
            /** 강사 화면에서 강조할 수강생. 강사에게 가는 알림에만 있다. */
            UUID studentId,
            String liveSessionStatus,
            OffsetDateTime scheduledAt,
            String replayStatus,
            /**
             * LIVE·RECORDED. 업로드 강의는 상세 화면이 따로 있어서, 이 값이 없으면 화면이 라이브
             * 강의 경로로만 보낸다. 레슨을 가리키지 않는 알림에서는 {@code null}이다.
             */
            String deliveryType
    ) {
    }
}

package com.liveclass.video.api;

import java.util.UUID;

/**
 * 강의가 지워질 때 그 강의의 녹화를 함께 정리하는 포트.
 *
 * <p>{@code video_asset}은 {@code lesson}을 FK로 참조하는데 삭제 규칙이 NO ACTION이다. 그래서 녹화가
 * 한 번이라도 남은 강의는 삭제가 <b>DB에서 막히고</b>, 그 실패가 "구조가 동시에 변경되었습니다. 다시
 * 시도해 주세요"라는 <b>일시적 충돌 메시지</b>로 올라와 강사가 영원히 재시도하게 된다. 실제로 그 상태였다.
 *
 * <p>curriculum 모듈이 video의 내부(자산 테이블·스토리지 규약)를 알지 않도록 이 포트로만 부탁한다.
 * 무엇을 지우는지는 video가 정한다 — 자산 행과 그 산출물(HLS 세그먼트·매니페스트) 둘 다다.
 */
public interface LessonRecordingCleanup {

    /**
     * 이 강의의 녹화 자산과 산출물을 지운다. 녹화가 없으면 아무 일도 하지 않는다(멱등).
     *
     * <p>스토리지 삭제는 <b>DB 커밋 뒤</b>에 일어난다. 먼저 지우면 트랜잭션이 되돌아갔을 때 강의는
     * 그대로인데 영상만 사라진다 — 되돌릴 수 없는 손실이라 순서를 뒤집지 않는다.
     *
     * @return 지운 자산(행) 수
     */
    int deleteByLesson(UUID lessonId);
}

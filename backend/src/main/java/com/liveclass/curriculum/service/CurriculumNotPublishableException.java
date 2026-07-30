package com.liveclass.curriculum.service;

/**
 * 커리큘럼 게시 선행 조건 미충족 — 섹션이 없거나 강의가 없다.
 *
 * <p>{@link CurriculumStateConflictException}(이미 게시됨·보관됨 같은 <b>상태</b> 충돌)과 구분한다.
 * 이쪽은 상태가 아니라 <b>내용</b>이 부족한 경우이고, 사용자가 할 일이 "기다리기"가 아니라
 * "섹션·강의 추가"라 화면 안내가 달라야 한다. FE가 코드로 갈라 읽으므로 별도 타입이 필요하다.
 *
 * <p>메시지는 서버가 만든다 — 세 경우(섹션 없음·강의 없음·둘 다 없음)의 문구가 정해져 있고
 * FE 비활성 안내와 같은 문장을 써야 하므로, 정본을 한쪽에 둔다.
 */
public class CurriculumNotPublishableException extends RuntimeException {

    public CurriculumNotPublishableException(String message) {
        super(message);
    }

    /** 부족한 것에 맞는 안내 문구를 만든다. 둘 다 없으면 한 문장으로 합친다. */
    public static CurriculumNotPublishableException of(boolean hasSection, boolean hasLesson) {
        if (!hasSection && !hasLesson) {
            return new CurriculumNotPublishableException("커리큘럼을 게시하려면 섹션과 강의를 각각 1개 이상 추가해주세요.");
        }
        if (!hasSection) {
            return new CurriculumNotPublishableException("커리큘럼을 게시하려면 섹션을 1개 이상 추가해주세요.");
        }
        return new CurriculumNotPublishableException("커리큘럼을 게시하려면 강의를 1개 이상 추가해주세요.");
    }
}

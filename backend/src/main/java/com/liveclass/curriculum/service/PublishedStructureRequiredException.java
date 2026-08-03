package com.liveclass.curriculum.service;

/**
 * 게시된 커리큘럼을 <b>빈 상태로 만드는</b> 삭제를 막는다.
 *
 * <p>게시에는 섹션 1개·강의 1개가 필요한데(`requirePublishableStructure`), 게시 <b>뒤에</b> 그것을
 * 지우는 것은 아무도 막지 않았다. 섹션 하나에 강의 하나만 둔 커리큘럼에서 그 강의를 지우면
 * <b>목차가 빈 커리큘럼이 카탈로그에 그대로 남는다</b> — 게시 조건을 우회한 것과 같다.
 *
 * <p>지우려면 먼저 보관(ARCHIVE)해서 카탈로그에서 내리거나, 대신할 강의를 먼저 만들면 된다.
 */
public class PublishedStructureRequiredException extends RuntimeException {

    public PublishedStructureRequiredException(String message) {
        super(message);
    }

    public static PublishedStructureRequiredException lastLesson() {
        return new PublishedStructureRequiredException(
                "게시된 커리큘럼의 마지막 강의는 삭제할 수 없습니다. 다른 강의를 먼저 추가하거나 커리큘럼을 보관해 주세요.");
    }

    public static PublishedStructureRequiredException lastSection() {
        return new PublishedStructureRequiredException(
                "게시된 커리큘럼의 마지막 섹션은 삭제할 수 없습니다. 다른 섹션을 먼저 추가하거나 커리큘럼을 보관해 주세요.");
    }
}

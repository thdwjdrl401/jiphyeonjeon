package com.liveclass.video.api;

import java.util.Optional;
import java.util.UUID;

/** curriculum의 소유권 facade가 호출하는 업로드 녹화강의 관리 포트. */
public interface RecordedVideoManagement {

    Optional<RecordedLessonView> findByClientRequestId(UUID clientRequestId);

    RecordedLessonView register(UUID lessonId, UUID clientRequestId);

    RecordedUploadTicket issueUpload(UUID lessonId, UUID uploaderId,
                                     String fileName, String contentType, long fileSize);

    RecordedProcessingView completeUpload(UUID lessonId, UUID assetId, UUID requesterId);

    RecordedProcessingView processing(UUID lessonId);

    RecordedProcessingView retry(UUID lessonId);
}

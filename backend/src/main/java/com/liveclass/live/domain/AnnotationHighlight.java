package com.liveclass.live.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강조 판서 스냅샷(ADR-0074). 강사가 강조 툴로 화면 일부를 표시한 순간의 화면 + 판서를 합성해
 * 잘라 둔 이미지 한 장.
 *
 * <p><b>강조 스트로크와 수명이 다르다.</b> 스트로크는 판서 요소라 지우개로 지워지고, 슬라이드가
 * 넘어가면 지우는 것이 정상이다. 그렇다고 이 행이 무효가 되지는 않는다 — 스냅샷은 "그 순간의 기록"이고
 * 그 순간의 강의 내용은 여전히 유효하다. 그래서 <b>요소 id를 참조하지 않는다.</b>
 */
@Entity
@Table(schema = "core", name = "annotation_highlight")
@Getter
@Setter
@NoArgsConstructor
public class AnnotationHighlight {

    @Id
    @GeneratedValue
    private UUID id;

    private UUID liveSessionId;

    /** 비정규화. 다시보기 앵커를 조인 없이 쓰기 위한 것. */
    private UUID lessonId;

    /** 비정규화. 검색 스코프가 커리큘럼이라 자료 청크와 같은 축을 갖는다. */
    private UUID curriculumId;

    /** 합성 크롭 이미지(PNG). 바이트는 스토리지에 있고 여기엔 참조만 둔다. */
    private UUID assetId;

    /** 라이브 시작 기준 경과 ms. 채팅·자막과 같은 축이다. */
    private Long sessionMs;

    /** 강사가 확인한 해석 텍스트. 없을 수 있다. */
    private String interpretedText;

    /** AI 색인 상태. PENDING은 아직 안 보냄, 나머지는 콜백이 확정한다. */
    private String indexStatus;

    /** 비전 설명 시도 횟수. 상한을 넘으면 FAILED로 내린다. */
    private int attemptCount;

    /** 이 시각 이후에 다시 시도한다(지수 백오프). null이면 즉시 대상. */
    private OffsetDateTime nextAttemptAt;

    /** 마지막 실패 사유. 왜 근거가 안 붙었는지 사람이 확인할 유일한 흔적이다. */
    private String lastError;

    /** 강사가 "이 근거 빼기"로 내린 시각(소프트 삭제). */
    private OffsetDateTime removedAt;

    @CreationTimestamp
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    private OffsetDateTime updatedAt;
}

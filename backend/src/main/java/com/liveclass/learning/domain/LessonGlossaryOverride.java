package com.liveclass.learning.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강사가 고치거나 더한 용어. 원본이 아니라 <b>덮어쓰기</b>다.
 *
 * <p>키가 용어 <b>이름</b>인 이유: ai 쪽 PK가 {@code (material_version_id, term)}이라 자료를 다시
 * 올리면 version_id가 바뀐다. 그 id를 참조하면 강사 수정이 자료 재업로드마다 끊긴다.
 */
@Entity
@Table(schema = "core", name = "lesson_glossary_override")
@IdClass(LessonGlossaryOverrideId.class)
@Getter
@Setter
@NoArgsConstructor
public class LessonGlossaryOverride {

    @Id
    private UUID lessonId;

    @Id
    private String term;

    private String definition;
    /**
     * 강사가 이 용어를 지운 시각. NULL이면 살아 있는 덮어쓰기다.
     *
     * <p>원본(ai 스키마)은 우리가 지울 수 없다 — 자료를 다시 읽을 때마다 되살아난다. 그래서 삭제는
     * 덮어쓰기와 같은 자리에 <b>묘비</b>로 남긴다. 같은 용어를 다시 등록하면 NULL로 되돌아간다.
     */
    private OffsetDateTime deletedAt;

    private UUID updatedBy;

    private OffsetDateTime updatedAt;
}

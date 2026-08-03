package com.liveclass.learning.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/** {@link LessonGlossaryOverride}의 복합키. (레슨, 용어) 하나가 한 행이다. */
public class LessonGlossaryOverrideId implements Serializable {

    private UUID lessonId;
    private String term;

    public LessonGlossaryOverrideId() {
    }

    public LessonGlossaryOverrideId(UUID lessonId, String term) {
        this.lessonId = lessonId;
        this.term = term;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LessonGlossaryOverrideId that = (LessonGlossaryOverrideId) o;
        return Objects.equals(lessonId, that.lessonId) && Objects.equals(term, that.term);
    }

    @Override
    public int hashCode() {
        return Objects.hash(lessonId, term);
    }
}

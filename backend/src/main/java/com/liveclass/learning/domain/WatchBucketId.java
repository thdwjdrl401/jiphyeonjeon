package com.liveclass.learning.domain;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/** {@link WatchBucket}의 복합키. (레슨, 사용자, 칸) 하나가 한 행이다. */
public class WatchBucketId implements Serializable {

    private UUID lessonId;
    private UUID userId;
    private Integer bucketIndex;

    public WatchBucketId() {
    }

    public WatchBucketId(UUID lessonId, UUID userId, Integer bucketIndex) {
        this.lessonId = lessonId;
        this.userId = userId;
        this.bucketIndex = bucketIndex;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        WatchBucketId that = (WatchBucketId) o;
        return Objects.equals(lessonId, that.lessonId)
                && Objects.equals(userId, that.userId)
                && Objects.equals(bucketIndex, that.bucketIndex);
    }

    @Override
    public int hashCode() {
        return Objects.hash(lessonId, userId, bucketIndex);
    }
}

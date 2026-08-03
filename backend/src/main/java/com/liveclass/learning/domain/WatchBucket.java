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
 * 한 사람이 한 칸을 몇 번 재생했는가.
 *
 * <p>재생바 위의 "많이 다시 본 구간" 그래프와 칸 기준 학습률이 모두 이 표에서 나온다 —
 * 한 번 보내서 둘 다 얻는다.
 *
 * <p>{@code playCount}가 2 이상이면 <b>다시 본 것</b>이다. 그래프는 칸마다
 * {@code sum(playCount) / 도달한 사람 수}로 강도를 만든다 — 절대 횟수를 그대로 그리면 뒤로 갈수록
 * 이탈자가 늘어 재시청과 무관하게 우하향 그래프가 나온다.
 */
@Entity
@Table(schema = "core", name = "watch_bucket")
@IdClass(WatchBucketId.class)
@Getter
@Setter
@NoArgsConstructor
public class WatchBucket {

    @Id
    private UUID lessonId;

    @Id
    private UUID userId;

    /** {@code floor(sessionMs / bucketSizeMs)}. 세션 상대 ms 축이라 라이브와 다시보기가 이어진다. */
    @Id
    private Integer bucketIndex;

    private Integer playCount;

    private OffsetDateTime updatedAt;
}

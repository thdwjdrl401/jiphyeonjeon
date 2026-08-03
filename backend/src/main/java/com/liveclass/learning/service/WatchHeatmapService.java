package com.liveclass.learning.service;

import com.liveclass.learning.api.LessonLearningAccess;
import com.liveclass.learning.domain.WatchBucket;
import com.liveclass.learning.repository.WatchBucketRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 구간별 시청 횟수 — 재생바 위 "많이 다시 본 구간" 그래프의 원본.
 *
 * <p><b>칸 길이는 고정이고 개수는 고정하지 않는다.</b> 라이브는 강의가 자라는 중이라 전체 길이를
 * 모르는데, 개수를 고정하면 길이가 바뀔 때마다 칸 경계가 흔들려 과거 기록과 어긋난다. 그래프 해상도는
 * 읽을 때 묶어서 맞춘다({@link #heatmap} 의 {@code points}).
 *
 * <p><b>절대 횟수를 그대로 주지 않는다.</b> 뒤로 갈수록 이탈자가 늘어, 합만 그리면 재시청과 무관하게
 * 우하향 그래프가 나온다. 칸마다 <b>도달한 사람 수로 나눠</b> 강도를 만든다 — 1.0이면 다들 한 번씩,
 * 2.0이면 평균 두 번 봤다는 뜻이다.
 */
@Service
public class WatchHeatmapService {

    /** 계약이 고정한 칸 길이. 바뀌면 과거 기록의 칸 번호가 다른 구간을 가리키게 된다. */
    public static final int BUCKET_SIZE_MS = 10_000;

    /** 그래프 가로 해상도. 강의 길이와 무관하게 일정해야 재생바 위에서 같은 밀도로 읽힌다. */
    private static final int GRAPH_POINTS = 100;

    private final WatchBucketRepository repository;
    private final LessonLearningAccess access;

    public WatchHeatmapService(WatchBucketRepository repository, LessonLearningAccess access) {
        this.repository = repository;
        this.access = access;
    }

    /**
     * 내가 쌓은 칸별 재생 횟수를 올린다.
     *
     * <p><b>누적 절대값을 받는다.</b> 증분을 받으면 재전송·중복 전송마다 횟수가 부풀고, 네트워크가
     * 불안한 곳에서 그래프가 조용히 왜곡된다. 절대값이면 같은 것을 여러 번 보내도 결과가 같다.
     */
    @Transactional
    public void record(UUID userId, UUID lessonId, Map<Integer, Integer> counts) {
        access.ensureCanLearn(userId, lessonId);
        counts.forEach((bucketIndex, playCount) -> {
            if (bucketIndex == null || bucketIndex < 0 || playCount == null || playCount <= 0) {
                return;   // 잘못된 칸 하나가 나머지 전송을 막지 않는다
            }
            repository.upsert(lessonId, userId, bucketIndex, playCount);
        });
    }

    /** 새로고침 뒤 이어서 세려면 내가 이미 쌓은 값을 알아야 한다. */
    @Transactional(readOnly = true)
    public Map<Integer, Integer> myBuckets(UUID userId, UUID lessonId) {
        access.ensureCanLearn(userId, lessonId);
        Map<Integer, Integer> mine = new LinkedHashMap<>();
        for (WatchBucket bucket : repository.findByLessonIdAndUserId(lessonId, userId)) {
            mine.put(bucket.getBucketIndex(), bucket.getPlayCount());
        }
        return mine;
    }

    /**
     * 그래프용 집계.
     *
     * <p>{@code durationMs}가 없으면(라이브가 아직 진행 중이라 길이를 모를 때) 기록된 마지막 칸까지를
     * 범위로 본다 — 그래야 진행 중에도 그릴 수 있다.
     */
    @Transactional(readOnly = true)
    public Heatmap heatmap(UUID userId, UUID lessonId, Long durationMs) {
        // 그래프는 강사가 보라고 만든 것이다 — 학습 게이트를 쓰면 정작 볼 사람이 막힌다.
        access.ensureCanViewInsights(userId, lessonId);
        List<WatchBucketRepository.BucketAggregate> rows = repository.aggregate(lessonId);
        if (rows.isEmpty()) {
            return new Heatmap(BUCKET_SIZE_MS, List.of(), 0);
        }

        int lastBucket = rows.get(rows.size() - 1).getBucketIndex();
        int totalBuckets = durationMs != null && durationMs > 0
                ? (int) Math.max(1, Math.ceil(durationMs / (double) BUCKET_SIZE_MS))
                : lastBucket + 1;

        // 칸 → 강도. 없는 칸은 아무도 안 봤다는 뜻이라 0이다.
        double[] intensity = new double[totalBuckets];
        long viewers = 0;
        for (WatchBucketRepository.BucketAggregate row : rows) {
            if (row.getBucketIndex() >= totalBuckets) {
                continue;   // 길이가 줄었다(재녹화 등) — 범위 밖은 버린다
            }
            intensity[row.getBucketIndex()] = row.getViewers() == 0
                    ? 0 : row.getPlays() / (double) row.getViewers();
            viewers = Math.max(viewers, row.getViewers());
        }

        return new Heatmap(BUCKET_SIZE_MS, downsample(intensity), viewers);
    }

    /**
     * 강의 길이와 무관하게 같은 개수로 묶는다. 6분 강의는 36칸이라 그래프가 뭉툭하고, 2시간은 720칸이라
     * 재생바에 다 그릴 수 없다 — 읽는 쪽에서 해상도를 맞춘다.
     *
     * <p>칸이 이미 {@value #GRAPH_POINTS}개 이하면 그대로 준다(늘리지 않는다 — 없는 정밀도를 지어내지 않는다).
     */
    private static List<Double> downsample(double[] intensity) {
        if (intensity.length <= GRAPH_POINTS) {
            return java.util.Arrays.stream(intensity).boxed().toList();
        }
        List<Double> points = new java.util.ArrayList<>(GRAPH_POINTS);
        for (int i = 0; i < GRAPH_POINTS; i++) {
            int from = (int) Math.floor(i * intensity.length / (double) GRAPH_POINTS);
            int to = (int) Math.floor((i + 1) * intensity.length / (double) GRAPH_POINTS);
            double sum = 0;
            for (int j = from; j < Math.max(to, from + 1); j++) {
                sum += intensity[j];
            }
            points.add(sum / Math.max(1, Math.max(to, from + 1) - from));
        }
        return points;
    }

    /**
     * @param bucketSizeMs 저장 칸 길이(ms). 화면이 점 하나가 몇 초인지 계산할 때 쓴다.
     * @param points       0.0 이상의 강도. 1.0이면 도달한 사람이 평균 한 번, 2.0이면 두 번 봤다.
     * @param viewers      가장 많은 사람이 도달한 칸의 인원. 그래프 신뢰도를 화면이 판단할 때 쓴다.
     */
    public record Heatmap(int bucketSizeMs, List<Double> points, long viewers) {
    }
}

# ADR-0117: 진도는 녹화가 준비될 때 정산된다

> 관련 결정: [songjeongki/ADR-0063 시청 구간 칸](0063-watch-heatmap-buckets.md) ·
> [songjeongki/ADR-0116 진도는 뒤로 가지 않는다](0116-progress-never-goes-backwards.md) ·
> [songjeongki/ADR-0033 학습 진도 배선](0033-learning-progress-wiring.md)

- **상태**: 채택
- **일자**: 2026-08-10
- **적용 범위**: 녹화 완료 시점의 진도 환산 — `RecordingReadyEvent` → learning

## 맥락

강사가 물었다 — "실시간으로 다 들었는데 왜 진행도가 100%가 아니냐".

[ADR-0116](0116-progress-never-goes-backwards.md)이 그중 하나(4%로 기록된 사고)를 고쳤지만, **더 큰
쪽이 남아 있었다.**

진도율은 **본 칸 ÷ 전체 칸**이고 전체 칸 수는 강의 길이에서 나온다. 그런데 그 길이는 **녹화가 끝나야**
생긴다. 그래서 라이브 중에는 화면이 진도를 아예 보내지 않는다.

```ts
if (!durationMs || durationMs <= 0) return null   // 라이브에는 분모가 없다
```

그 대신 라이브에서 본 칸은 서버에 쌓이고, **학생이 다시보기를 열면** 그 누적을 물려받아 진도로
환산됐다. 코드 주석도 그렇게 적고 있었다 — *"라이브로 들은 시간이 사라지지는 않는다"*.

**문제는 그 환산이 브라우저에서만 일어난다는 것이었다.**

- 끝까지 듣고 다시보기를 열지 않으면 **0%로 남는다.** 학생 입장에서는 다 들었는데 0%이고, 왜 그런지
  알 방법도 없다.
- **녹화가 없거나 실패한 강의**에서는 열 다시보기가 없으므로 영영 0%다.

## 결정

### 1. 녹화가 준비되는 순간 서버가 환산한다

`RecordingReadyEvent`에 `durationMs`를 싣고, 그 사건에서 쌓인 칸을 진도로 정산한다. **그 순간이
라이브 시청분에 분모가 처음 생기는 자리**다.

```sql
INSERT INTO core.learning_progress (user_id, lesson_id, progress_percent, completed_at)
SELECT w.user_id, :lessonId,
       LEAST(100, ROUND(COUNT(*) * 100.0 / :totalBuckets)),
       CASE WHEN ROUND(COUNT(*) * 100.0 / :totalBuckets) >= :completionThreshold THEN now() END
FROM core.watch_bucket w
WHERE w.lesson_id = :lessonId
GROUP BY w.user_id
ON CONFLICT (user_id, lesson_id) DO UPDATE
SET progress_percent = GREATEST(core.learning_progress.progress_percent, EXCLUDED.progress_percent),
    completed_at = COALESCE(core.learning_progress.completed_at, EXCLUDED.completed_at),
    updated_at = now()
```

- **진도는 내려가지 않는다**([ADR-0116](0116-progress-never-goes-backwards.md)) — `GREATEST`.
- **멱등하다.** 다시 돌려도 결과가 같아 재처리·재시도가 안전하다.
- **`last_position_ms`는 손대지 않는다.** 라이브로 들은 사람에게 "이어볼 위치"란 것이 없고, 이미 있는
  값을 0으로 되돌리면 이어보기가 망가진다. 새로 만드는 행만 기본값 0으로 들어간다.
- **분모는 화면과 같은 식**이다(`ceil(길이 / 10초)`, 최소 1). 다르면 같은 시청이 화면과 서버에서 다른
  비율로 보인다.
- 길이를 모르면 **아무것도 하지 않는다.** 잘못 계산하는 것보다 예전 상태로 두는 편이 낫다.

### 2. 방향은 learning이 선언하고 video가 부른다

learning이 녹화 사건을 직접 들으면 순환이 생긴다. Modulith가 실제로 잡았다.

```
aiintegration → learning → video → aiintegration
```

그래서 learning이 `WatchProgressSettlement` 포트를 선언하고, **사건의 주인인 video**가 그것을 부른다.
레슨→섹션 관계를 curriculum에게 묻는 `LessonLearningAccess`와 같은 방향 규칙이다.

### 3. 커밋 뒤에 돈다

`AFTER_COMMIT` + `REQUIRES_NEW`. 녹화 확정 트랜잭션에 이 일을 얹으면 webhook 처리가 그만큼 길어지고,
환산이 실패했다고 녹화 확정을 되돌릴 이유도 없다 — 진도는 다음 환산에서 따라잡을 수 있는 값이다.

## 결과

- **다시보기를 열지 않아도** 라이브 시청분이 진도가 된다.
- 학생이 아무것도 하지 않아도 되고, 강사는 실제 수강 상태를 본다.
- 화면 쪽 환산은 그대로 둔다 — 다시보기를 보는 동안의 진도는 여전히 화면이 실시간으로 보낸다.
  둘은 같은 규칙을 쓰고 서로를 덮지 않는다(둘 다 `GREATEST`).

## 검증

- `live_watching_becomes_progress_without_opening_the_replay` — 10칸 중 9칸을 라이브로 본 학생이,
  다시보기를 열지 않았는데 90%·완료가 되는지.
- `settling_twice_changes_nothing` — 멱등.
- `settling_never_lowers_an_existing_progress` / `settling_raises_a_lower_existing_progress` —
  한 방향으로만 움직이는지, `last_position_ms`는 그대로인지.
- `an_unknown_duration_settles_nothing` — 길이를 모르면 저장소를 아예 부르지 않는지.
- `the_denominator_matches_the_screen_for_the_lesson_that_showed_4_percent` — 운영에서 4%가 났던
  그 강의(244,050ms)가 25칸으로 계산되는지.
- `ModularityTests` — 이 변경이 실제로 순환을 만들었고, 포트로 방향을 뒤집어 해소했다.
- 백엔드 **774건** 통과.

### 테스트에서 걸린 것 둘

- **`REQUIRES_NEW`는 롤백하는 테스트 트랜잭션의 미커밋 데이터를 볼 수 없다.** 처음에는 리스너를 그대로
  불러 놓고 결과를 봤는데, 아무 일도 일어나지 않아서 통과하는 테스트가 됐다. SQL은 같은 트랜잭션에서
  직접 부르고 리스너는 목으로 보도록 갈랐다.
- **네이티브 쓰기는 영속성 컨텍스트를 건너뛴다.** 같은 트랜잭션에서 이미 읽어 둔 진도 엔티티가 옛 값
  그대로 남아, 올라간 진도가 화면에 반영되지 않았다. `@Modifying(clearAutomatically, flushAutomatically)`가
  필요했다 — 테스트만의 문제가 아니라 실제 동작의 문제다.

## 남은 일

**녹화가 아예 없는 강의는 여전히 0%다.** 정산의 근거가 녹화 길이이기 때문이다. 예정 시간
(`expectedDurationMinutes`)으로 환산할 수도 있지만 그 값은 강사가 적은 계획이지 실제가 아니라, 진도의
근거로 삼기에는 약하다. 라이브 실제 진행 시간(`startedAt`~`endedAt`)을 쓰는 편이 낫다고 보지만,
녹화 없는 강의를 얼마나 다룰지부터 정하고 손대는 것이 맞다.

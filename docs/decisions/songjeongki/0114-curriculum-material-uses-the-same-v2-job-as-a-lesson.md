# ADR-0114: 커리큘럼 자료도 레슨과 같은 v2 잡을 쓴다

> 관련 결정: [songjeongki/ADR-0042 커리큘럼 자료 연결·임베딩 스코프](0042-curriculum-material-attach-and-embedding-scope.md)(후속 완료) ·
> [canola/ADR-0045 커리큘럼 종속 자료 색인](../canola/0045-curriculum-scoped-material-indexing.md) ·
> [songjeongki/ADR-0112 검색은 붙은 자리를 지킨다](0112-material-search-respects-the-scope-it-was-attached-to.md)

- **상태**: 채택
- **일자**: 2026-08-10
- **적용 범위**: `InstructorCurriculumService.attachCurriculumMaterial` — 커리큘럼 자료의 임베딩 잡 봉투

## 맥락

강사가 물었다 — "커리큘럼에 올린 자료가 **핵심 용어에 표시가 안 된다**".

운영 데이터를 보니 커리큘럼 자료 7건이 **전부** `key_term_status = NOT_REQUESTED`였다. 레슨 자료는
36건이 `READY`였다.

**그런데 용어는 이미 뽑혀 있었다.**

```
파일                   ai 상태   청크   ai.material_key_term   core.key_term_status
ppt.pptx               ACTIVE     17            8              NOT_REQUESTED
demo_deadlock.pptx     ACTIVE      8           13              NOT_REQUESTED
demo_deadlock.pptx     ACTIVE      8           15              NOT_REQUESTED
```

**36개가 저장돼 있는데 화면은 모른다.** 원인이 두 겹이었다.

### 1. 커리큘럼 잡만 v1이었다

`attachCurriculumMaterial`이 싣던 봉투는 `contractVersion: 1`, `policy: {embedModel}`이었다. 주석이
이유를 적어 두고 있었다 — *"현재 worker의 curriculum scope 배선은 후속 범위이므로 v1 계약을 유지하고
용어 추출은 요청하지 않는다"*. [ADR-0042](0042-curriculum-material-attach-and-embedding-scope.md)가
"AI 오너 몫"으로 남긴 그 후속이다.

**그 후속은 [ADR-0045](../canola/0045-curriculum-scoped-material-indexing.md)로 이미 끝나 있었다.**
워커는 `scope=CURRICULUM`과 `lessonId` 없음을 정상으로 받는다. 남은 것은 봉투를 올리는 일뿐이었다.

### 2. v1을 남겨 둔 대가가 컸다

워커는 **v1에서도 용어를 뽑는다** — 요청이 없으면 추출기가 배선돼 있는지로 결정한다
(`index_pptx_material.py`). 그런데 결과 봉투는 v2에서만 싣는다.

```python
if result is not None and isinstance(job, PptxEmbedJob) and job.contract_version == 2:
    payload["outputs"] = MaterialCallbackOutputs(..., keyTermResult=...)
```

Spring 쪽은 그 `outputs`가 있어야만 상태를 옮긴다(*"outputs가 없는 v1 callback은 기존 행의 상태를
건드리지 않는다"*). 그래서 **뽑는 비용은 다 치르고 결과만 버리는** 상태가 됐다.

### 3. 상태 기계가 한 겹 더 막았다

설령 결과가 와도 못 받아 적는다. `MaterialKeyTermStatus`는 `NOT_REQUESTED`에서 `PENDING`으로만
갈 수 있다.

```java
case NOT_REQUESTED -> target == PENDING;
```

`attachCurriculumMaterial`은 `updateKeyTermStatus(..., "PENDING")`을 부르지 않았으므로, `READY`
callback이 와도 전이가 거부된다.

## 결정

**커리큘럼 자료를 레슨 자료와 똑같이 다룬다.** 스코프만 다르고 나머지는 같다.

1. 봉투를 **v2**로 올리고 `policy.extractKeyTerms = true`를 싣는다.
   v2는 이 필드를 필수로 요구하므로(`material_jobs.py`) 둘은 한 쌍이다.
2. attach 시 `updateKeyTermStatus(materialId, "PENDING")`을 부른다. 상태 기계가 요구하는 첫 전이다.
3. 응답도 레슨과 같은 `withProcessingPending`을 쓴다. `withEmbeddingPending`은 "커리큘럼은 용어를
   요청하지 않는다"를 표현하려고 만든 것이라 함께 지운다.

`scope=CURRICULUM`과 `lessonId` 부재는 그대로다 — 커리큘럼 자료에 `lessonId`를 실으면 워커가 모순된
payload로 거부한다([ADR-0045](../canola/0045-curriculum-scoped-material-indexing.md) §2).

## 결과

- 커리큘럼에 올린 자료도 핵심 용어가 화면에 뜬다.
- 뽑아 놓고 버리던 결과가 쓰인다. 이미 색인된 자료는 **재처리하면 살아난다**(용어 36개는 이미 있다).
- 커리큘럼 자료와 레슨 자료의 차이가 **스코프 하나로 줄었다.** 봉투 버전·정책·상태 전이가 같아져,
  한쪽만 고쳐 다른 쪽이 뒤처지는 종류의 사고가 줄어든다.
- 공유 계약 변경 없음. `scope`와 `contractVersion`은 이미 계약에 있는 필드다.

## 검증

- `InstructorCurriculumMaterialEmbeddingContractTest.curriculum_material_attach_publishes_the_same_v2_job_and_requests_key_terms`
  — 봉투가 `scope=CURRICULUM` · `lessonId` 없음 · `extractKeyTerms=true` · `contractVersion=2`인지,
  그리고 `updateKeyTermStatus(materialId, "PENDING")`이 불리는지.
- **돌연변이 확인**: 봉투를 v1로 되돌리면 이 테스트가 깨진다.
- 레슨 쪽 기존 테스트(`lesson_material_attach_publishes_v2_embedding_and_key_term_job`)는 그대로 통과 —
  두 경로가 이제 같은 것을 주장한다.
- 백엔드 **764건** 통과.

## 남은 일 (이 ADR의 범위 밖)

- **이미 올라간 자료의 재처리.** 지금 `NOT_REQUESTED`·`PENDING`·`FAILED`로 남은 것들은 이 변경으로
  저절로 낫지 않는다. 재요청 경로가 필요하다.
- **일시적 실패의 재시도.** 의존성이 잠깐 내려간 사이 올린 자료가 `FAILED`로 굳는다(운영에서
  `/readyz` 503 구간에 올린 파일이 그렇게 됐다). 재시도도 정리도 하는 주체가 없다.

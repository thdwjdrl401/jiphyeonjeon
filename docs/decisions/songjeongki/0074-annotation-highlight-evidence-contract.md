# ADR-0074: 강조 판서를 영실이 근거로 쓰기 위한 계약 요청

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책:
> [../../harness/POLICY.md](../../harness/POLICY.md) · 공유 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 제안 — AI 파트 협의 대기
- **일자**: 2026-08-04
- **관련**:
  [ADR-0036](0036-material-embedding-pipeline.md)(자료 임베딩 파이프라인·outbox),
  [ADR-0054](0054-annotation-ai-semantics-not-coordinates.md)(판서 해석 — 좌표를 묻지 않는다),
  [ADR-0058](0058-annotation-interpret-image-by-url.md)(해석 이미지를 URL로 넘긴다),
  [canola/ADR-0015](../canola/0015-rag-index-shadow-version-storage.md)(RAG 색인 저장),
  [jinwoo/ADR-0008](../jinwoo/0008-replay-rag-answer-v2-endpoint.md)(다시보기 근거 응답 v2),
  [canola/ADR-0037](../canola/0037-replay-ai-caption-context-contract.md)(자막 근거 계약 요청 — 같은 형식의 선례)

## 요청 요약

강사가 라이브 중 **강조 툴**로 화면의 한 부분을 표시하면, 그 순간의 **화면(슬라이드/카메라) + 판서를
합성한 이미지**를 잘라 AI에 넘긴다. AI는 이미지를 텍스트로 옮겨 색인하고, **영실이가 답할 때 자료와
함께 근거로 사용**한다.

Spring·FE 쪽 구현(툴·크롭·합성·업로드·저장)은 우리가 한다. **이 문서가 요청하는 것은 AI 파트가
받아 줄 메시지 계약과, 근거 응답에 판서를 표현할 자리다.** 모델 선정·색인 방식·API 내부 구조는
AI 오너가 정한다.

## 현재 부족한 점

- 지금 판서를 이미지로 읽는 경로는 있다(ADR-0054·0058). 그러나 **결과가 어디에도 저장되지 않는다** —
  화면에 적용하고 끝이고, 이미지도 "모델이 읽으면 즉시 폐기"다. 벡터DB로 갈 출발점이 없다.
- 영실이의 근거 공간은 **PPTX 자료 청크뿐**이다. `MaterialChunkHit`이
  `material_version_id`·`material_id`·`material_version`·`page`를 필수로 갖고,
  `ActiveMaterialSearchPort.search_active(curriculum_id, …)` 하나만 있다.
- 판서는 자료가 아니라 이 모델에 들어갈 수 없다. 억지로 채우면 근거 표시가 "3페이지"라고 거짓말한다.

## 원하는 흐름

```text
강사가 강조 툴로 화면 일부에 표시
  → 그리기 종료 1초 뒤, 그 영역을 여백 포함해 크롭
     (화면공유 프레임 우선, 없으면 카메라 + 판서 레이어 합성 — 강조 표시가 이미지에 함께 들어간다)
  → 강사 확인 다이얼로그
  → Spring이 이미지를 에셋으로 저장하고 스냅샷 행을 남긴 뒤 outbox에 잡을 싣는다
  → AI가 이미지를 읽어 텍스트화·색인
  → 수강생이 영실이에게 질문하면 자료 청크와 함께 이 스냅샷이 근거로 검색된다
  → FE가 근거를 표시하고, 누르면 그 시점(sessionMs)의 영상으로 이동한다
```

**강조 표시를 이미지에서 빼지 않는다.** 어디가 강조된 부분인지를 모델에 알려 주는 신호이기 때문이다.
(판서 해석 경로는 반대로 표시를 빼야 한다 — 도형으로 오독된다. **두 경로는 별개다.**)

## 요청 1 — 색인 잡을 받아 달라

기존 자료 임베딩과 **같은 큐·같은 봉투**를 쓴다(ADR-0036). 새 전송 방식을 만들지 않는다.

```json
{
  "taskType": "ANNOTATION_EMBED",
  "snapshotId": "uuid",
  "assetId": "uuid",
  "sessionId": "uuid",
  "lessonId": "uuid",
  "curriculumId": "uuid",
  "sessionMs": 725300,
  "capturedAt": "2026-08-04T13:20:05+09:00",
  "interpretedText": "…",
  "policy": { "embedModel": "bge-m3" },
  "contractVersion": 1
}
```

- **이미지는 `assetId`로만 준다.** URL·버킷 경로를 싣지 않는다. 워커가 처리 직전에
  `POST /api/internal/ai/materials/download-url`(또는 동등한 신규 경로)로 갓 서명된 presigned GET을
  받아 읽는다 — 큐에 오래 묵어도, 재시도해도 만료되지 않는다(ADR-0036 B안).
- **`curriculumId`가 검색 스코프**다. 자료와 같은 축이라 한 커리큘럼 안에서 함께 검색된다.
- **`sessionMs`는 다시보기 타임라인 앵커**다. 근거를 누르면 그 시점으로 이동하는 데 쓴다.
- **`interpretedText`는 우리가 이미 가진 해석**이다(비어 있을 수 있다). AI가 이미지를 다시 읽어
  다른 텍스트를 만들면 **강사 화면에 보이는 것과 근거가 갈라진다.** 있으면 우선 신뢰하고, 이미지로는
  그것이 못 담는 것(슬라이드 본문·도표 안 글자·맥락)을 보강해 주기를 요청한다.

**콜백**은 기존 규약 그대로 받는다(`POST /api/internal/ai/callbacks`, HMAC·eventId 멱등):
`ANNOTATION_EMBEDDING` / `ANNOTATION_EMBEDDED` / `ANNOTATION_EMBED_FAILED`. `snapshotId`를 그대로
돌려주면 우리가 상태를 확정한다.

## 요청 2 — 색인 제거를 받아 달라

```json
{ "taskType": "ANNOTATION_EMBED_DELETE", "snapshotId": "uuid", "contractVersion": 1 }
```

**지우개와는 무관하다.** 강조 스트로크를 지우는 것은 "슬라이드가 넘어가 화면과 안 맞는다"는 뜻이지
"그 내용이 틀렸다"가 아니다. 스냅샷은 **그 순간의 기록**이라 스트로크와 수명이 분리된다.

제거가 필요한 경우는 둘이다 — **강의·세션 삭제**(없는 강의 내용이 근거로 계속 나오면 안 된다.
오늘 녹화 정리에서 같은 문제를 겪었다), 그리고 **강사가 명시적으로 "이 근거 빼기"** 를 누를 때.

## 요청 3 — 근거에 출처 종류를 넣어 달라

이게 AI 파트 내부 구조에 가장 영향이 크고, **우리가 대신 정할 수 없는 부분**이다.

지금 `MaterialChunkHit`은 PPTX 전용이다. 판서 스냅샷이 근거로 나오려면 검색이 두 소스를 합쳐야 하고,
응답이 어느 쪽인지 구분할 수 있어야 한다. 예를 들면:

```json
{
  "sourceType": "ANNOTATION",
  "snapshotId": "…", "lessonId": "…", "sessionMs": 725300,
  "excerpt": "…", "score": 0.71
}
```

필드 이름·구조는 AI 오너가 정해도 된다. **필요한 것은 세 가지뿐이다** — (1) 자료와 판서를 구분할 수
있을 것, (2) 판서 근거에 `sessionMs`가 실려 화면이 영상 위치로 이동시킬 수 있을 것, (3) 근거 본문
excerpt가 올 것(사용자가 무엇을 근거로 답했는지 확인해야 한다 — ADR-0037이 자막에 대해 요청한 것과 같다).

## 우리가 보장하는 것

- **강사가 확인한 것만 보낸다.** 모델이 낸 `confidence`는 근거가 되지 못한다(실측에서 틀린 한글
  라벨에 1.0이 붙었다 — ADR-0054). 자동 색인은 하지 않는다. 운영 경험이 쌓이면 이 단계를 뺄지 다시 본다.
- **한 강조당 한 스냅샷**이다. 중복 발송은 `snapshotId`로 멱등 처리할 수 있다.
- 이미지는 **PNG**, 크기는 크롭 영역에 따르며 상한을 둔다(값은 협의).
- 스위치 뒤에 둔다. 꺼져 있으면 잡이 실리지 않아 AI 쪽이 준비되기 전에도 무해하다(ADR-0036과 동일).

## 열린 질문 (AI 파트에)

1. 이미지 다운로드를 **자료와 같은 엔드포인트**로 받을지, 판서용 경로를 새로 팔지.
2. `interpretedText`가 있을 때 **그것을 신뢰할지, 이미지를 다시 읽을지**. 갈라지면 화면과 근거가 어긋난다.
3. 판서 스냅샷을 **자료와 같은 색인에 넣을지, 별도 색인 후 검색에서 합칠지**.
4. 이미지 크기 상한과 권장 해상도.

## 우리 쪽 진행 (AI 대기 없이 간다)

1. 강조 툴 + 합성 크롭 + 확인 + 에셋 업로드 + 스냅샷 저장 — **AI 없이 완결된다.**
2. 강조 내역 패널(썸네일·시각·상태·제거).
3. 위 계약이 정해지면 outbox 발행·콜백·근거 표시 연결.

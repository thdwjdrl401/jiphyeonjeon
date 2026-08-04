# ADR-0008: Replay RAG 질문·답변을 위한 `/internal/v2/rag/answers:stream` 설계

- **상태**: 제안
- **일자**: 2026-08-03
- **관련**: [ADR-0037(요구사항, canola)](../canola/0042-replay-ai-caption-context-contract.md),
  [ADR-0007](0007-curriculum-scoped-rag-material-sharing.md)(curriculum 스코프 자료 검색),
  `ai/ai-api/app/rag/models.py`, `ai/ai-api/app/rag/service.py`,
  `ai/ai-api/app/rag/retrieval.py`, `ai/ai-api/app/rag/ports.py`, `ai/ai-api/app/api/rag.py`

## 맥락

ADR-0037은 다시보기(Replay)에서 영실이에게 질문하면 질문 시점 주변의 확정 자막과 기존 PPTX 자료를
함께 근거로 써야 한다는 세 오너(FE/Spring/AI) 공통 요구사항을 정의한다. 이 문서는 그중 **AI(ai-api)
쪽 구현만** 다룬다 — FE·Spring 내부 구조는 각 팀원이 별도로 결정한다.

현재 `/internal/v1/rag/answers:stream`(`app/api/rag.py`)은 Live 전용이다: `contextTimeMs`는
STT attempt-local 시간이고, 자막(`CombinedEvidenceRetriever`, `retrieval.py`)은 ai-api가 realtime
Redis stream에서 최신 attempt를 직접 조회한다(`CaptionContextPort.query`). ADR-0037은 이 축을 재사용할
수 없다고 명시하고, 대신 Spring이 이미 세션 시간으로 변환한 자막 목록을 요청 바디에 실어 보낸다 —
즉 ai-api는 Replay 자막을 **다시 조회할 필요가 없다.** 반대로 PPTX 자료 검색(`MaterialRetrievalPort`,
vector top-3)은 질문 시점과 무관한 의미 기반 검색이라 Live/Replay 구분 없이 그대로 재사용 가능하다.

ADR-0037 §"필요한 RAG 결과"는 응답에 `answer.done.sources`마다 원문 그대로의 plain-text
`excerpt`(최대 300자)를 추가하도록 요구하지만, "Live v1 source에는 이 제안 때문에 필드를 추가하지
않는다"고 명시한다 — v1 스키마·동작은 절대 변경하지 않는다는 전제가 이미 요구사항 문서 수준에서
고정돼 있다.

## 결정

### 요청/응답 스키마: v1과 완전히 분리된 v2 전용 모델

`RagAnswerRequest`, `PptxSource`, `CaptionSource`(`models.py`)는 모두 `extra="forbid"` 계약
모델이라 필드를 옵션으로 얹어도 v1 호출자에게는 안 보이지만, ADR-0037이 v1 불변을 명시적으로
요구하므로 별도 대안을 검토할 필요 없이 신규 모델(`RagAnswerRequestV2`, `ReplayContext`,
`CaptionContextItem`, `PptxSourceV2`, `CaptionSourceV2`)로 분리한다. 필드명은 ADR-0037의 wire 예시를
그대로 따른다(`questionSessionMs`, `captions[].startSessionMs/endSessionMs` 등 — v1의
`contextTimeMs`/`startMs`/`endMs`와 이름이 달라도 그대로 유지, 억지로 맞추지 않는다).

**주의**: `CaptionSourceV2`(응답 `answer.done.sources`용)는 v1 `CaptionSource`를 그대로 베끼면 안 된다.
ADR-0037의 응답 예시는 `type/sessionId/startSessionMs/endSessionMs/excerpt`만 담고 **`sttSessionId`가
없다.** `sttSessionId`는 요청 쪽 `CaptionContextItem`에만 존재하는 필드다.

### 자막 근거 수집: 신규 `ReplayEvidenceRetriever` 클래스 분리

| 대안 | 판단 |
|---|---|
| **(채택) `ReplayEvidenceRetriever` 신규 클래스** — PPTX는 기존 `MaterialRetrievalPort`를 그대로 주입받아 재사용, caption은 `request.context.captions`를 **v1 `_build_caption_evidence`와 동일한 방식으로 합쳐서** `RetrievedEvidence` 1개로 매핑함(Redis 조회 없음) | 기존 `CombinedEvidenceRetriever`/`CaptionContextPort`/`test_retrieval.py` 등 Live 경로에 손을 대지 않아 회귀 위험이 없다. 새 파일 하나 추가로 끝난다 |
| `CombinedEvidenceRetriever`의 caption 조회 부분을 `CaptionContextPort` 대신 더 넓은 Protocol로 추상화해 Live/Replay 양쪽이 같은 클래스를 쓰게 함 | 코드 중복은 줄지만, 이미 테스트가 붙어 있는 Live 전용 클래스의 생성자·내부 분기를 건드려야 해서 v1 회귀 위험이 생긴다. "caption 소스가 다르다"는 차이 하나 때문에 기존 안정 코드를 리팩터링할 이유가 부족하다 |

PPTX 검색 로직(`MaterialRetrievalPort.retrieve`, threshold 0.25/0.0, top_k=3)은 두 리트리버가
동일 포트를 주입받아 **코드 자체를 공유**한다 — 별도 구현체를 만들지 않는다.

**주의**: ADR-0037은 "자막 근거가 있으면 자료 근거에 자막 source **한 개**가 추가될 수 있다"고
명시한다. `context.captions[]`에 최대 20개 발화가 들어와도 `RetrievedEvidence`/`CaptionSourceV2`는
**항상 1개**여야 한다 — v1의 `_build_caption_evidence`(`retrieval.py:90`)가 여러 caption item의
`text`를 이어 붙이고 `startMs`=첫 항목, `endMs`=마지막 항목으로 합치는 것과 동일한 병합 로직을
`ReplayEvidenceRetriever`에도 그대로 적용한다(각 발화를 별도 evidence로 매핑하지 않는다).

### 서비스 계층: 기존 `RagAnswerService` 재사용, retriever/모델 타입만 교체

| 대안 | 판단 |
|---|---|
| **(채택) `RagAnswerService`를 그대로 재사용**하되 `EvidenceRetriever`/`AnswerModel` Protocol의 request 타입을 v1/v2 공용으로 넓힘(Union 또는 구조적 타이핑) | `_produce`의 스트리밍·타임아웃·registry·`_unique_sources`·`_validate_evidence_scope` 로직이 v1/v2에서 완전히 동일하다. 이미 검증된 로직을 복제하면 두 곳에서 같은 버그를 따로 고쳐야 하는 위험이 생긴다 |
| `ReplayAnswerService`를 완전 별도 클래스로 신설 | v1과 v2가 스키마 diverge할 미래 가능성에 대비할 수 있지만, 현재 요구사항엔 그런 조짐이 없다. 지금 당장 필요하지 않은 유연성을 위해 스트리밍/타임아웃/취소 처리 같은 까다로운 동시성 코드를 통째로 복제하는 비용이 더 크다 |

`_validate_evidence_scope`의 `CaptionSource` 분기(`lesson_id`/`sessionId` 일치 검증)는 Replay
caption도 Spring이 이미 올바른 스코프로 채워 보내므로 로직 변경 없이 그대로 통과한다.

**주의**: `_unique_sources`(`service.py:201`)는 그대로 재사용하지 않는다. 이 함수는 frozen source
객체 전체의 동등성으로 dedup하는데, v2 source에는 `excerpt`(자유 텍스트) 필드가 섞여 있어 ADR-0037이
요구하는 dedup 키 — PPTX는 `(materialId, page)`, CAPTION은 `(sessionId, startSessionMs,
endSessionMs)` — 와 어긋날 수 있다(같은 자료·같은 페이지인데 excerpt만 미묘히 달라 중복 제거가
안 되는 경우). v2 전용으로 이 튜플 키만 보고 dedup하는 별도 함수를 만들고, `excerpt`는 그 키의 첫
항목 값을 그대로 쓴다.

### excerpt 생성: `RetrievedEvidence.content` 단순 300자 슬라이스

| 대안 | 판단 |
|---|---|
| **(채택) `content[:300]` 단순 truncate** | ADR-0037 요구사항은 "최대 300자, 원문 그대로, 모델이 재요약하지 않음"만 명시하고 문장 경계 보존은 요구하지 않는다. 계약을 충족하는 가장 단순한 구현을 쓴다 |
| 문장/공백 경계를 찾아 자연스럽게 자르기 | 요구사항에 없는 품질 요구를 임의로 얹는 과설계. 필요해지면 그때 추가한다 |

### 라우터: prefix만 분리, 인증·SSE 인코딩은 기존 코드 재사용

`create_rag_router()`(`app/api/rag.py`)를 prefix/모델 파라미터를 받도록 일반화하거나, v2 전용
`create_rag_router_v2()`를 병렬로 둔다(둘 다 `InternalRequestAuthenticator`, `encode_sse_stream`,
`_accepts_event_stream`은 그대로 재사용 — HMAC 시크릿과 신선도 검증 정책도 v1과 동일 수준 유지).
구체적 함수 분리 방식은 구현 시 실제 코드량을 보고 결정한다(이 문서의 스코프는 "무엇을 재사용하고
무엇을 새로 만드는가"까지).

## 세부 동작 요약

```
POST /internal/v2/rag/answers:stream
  → 기존 HMAC 인증 재사용
  → RagAnswerRequestV2 파싱 (context.mode=REPLAY 고정)
  → ReplayEvidenceRetriever.retrieve()
      PPTX top-3 (기존 MaterialRetrievalPort)
      + request.context.captions[] → RetrievedEvidence 1개로 병합 (재조회 없음, v1과 동일한 concat 방식)
  → 기존 _validate_evidence_scope 재사용
  → v2 전용 dedup: (materialId,page) / (sessionId,startSessionMs,endSessionMs) 키 기준
  → excerpt 매핑 (content[:300]), CaptionSourceV2는 sttSessionId 미포함
  → 기존 GMS 모델 스트리밍 그대로
  → answer.delta* → answer.done(sources: PptxSourceV2 | CaptionSourceV2, excerpt 포함)
```

## 영향·후속

- v1 파일(`models.py`의 `RagAnswerRequest`/`PptxSource`/`CaptionSource`, `retrieval.py`의
  `CombinedEvidenceRetriever`)은 이 작업에서 **한 줄도 수정하지 않는다** — 새 파일/새 클래스 추가만
  발생한다.
- `EvidenceRetriever`/`AnswerModel` Protocol의 request 타입을 넓히는 부분은 정적 타입 체크(mypy 등)
  설정에 따라 `Union[RagAnswerRequest, RagAnswerRequestV2]` 또는 `Protocol` 제네릭화가 필요할 수
  있다 — 실제 구현 시 프로젝트의 타입 체크 방식을 먼저 확인한다.
- `ai/ai-api/CONTRACT.md`, `ai/ai-api/README.md`, `app/api/README.md`, `app/rag` 관련 README는
  구현과 같은 변경에서 갱신한다. 루트 `docs/CONTRACT.md`/`docs/ai/CONTRACT.md`는 세 오너 합의가
  끝난 뒤 별도로 반영한다(jinwoo 소유 파일이 아니므로 직접 수정하지 않는다).
- 알려진 미확정 사항(ADR-0037에서 이미 명시): 실제 wire 필드명이 FE/Spring 합의 과정에서 미세하게
  달라질 수 있다 — 이 문서의 필드명은 ADR-0037 예시를 그대로 따른 초안이며, 최종 계약 문서가 먼저다.

## 구현 중 조정 (2026-08-03)

설계 단계에서 "서비스 계층: 기존 `RagAnswerService` 재사용"으로 정했던 결정을 실제 구현 중 뒤집었다.

### 무엇이 바뀌었나

- 당초 계획: `RagAnswerService`를 그대로 두고 `EvidenceRetriever`/`AnswerModel` Protocol의 request
  타입만 v1/v2 공용으로 넓혀 재사용한다.
- 실제 구현: `RagAnswerService`를 손대지 않고, `app/rag/replay_service.py`에 별도 `ReplayAnswerService`
  클래스를 새로 만들었다. `app/adapters/gms_openai_answer_v2.py`의 `GmsOpenAIAnswerModelV2`도 같은
  이유로 별도 클래스다.

### 왜 바뀌었나

`RagAnswerService._produce`를 열어보니 세 곳이 v1 타입에 직접 고정돼 있었다 —
`_validate_evidence_scope`의 `isinstance(item.source, PptxSource)` 분기, `_unique_sources`의 전체
객체 동등성 dedup, 마지막 `AnswerDone(data=AnswerDoneData(...))` 생성. 이 세 곳을 v1/v2 공용으로
만들려면 `service.py` 자체를 수정해야 하는데, 그러면 "v1 파일은 한 줄도 안 건드린다"는 이 문서와
ADR-0037의 전제와 충돌한다.

대신 `_produce`를 감싸는 나머지 전부 — `AnswerEventStream`(취소·정리), `_close_iterator`,
`_error_event`/`_safe_adapter_error_event`(에러 카탈로그), `INSUFFICIENT_MESSAGE`/`GENERIC_ERROR_MESSAGE`,
`InMemoryRequestRegistry`/`RequestLease` — 는 v1 타입에 의존하지 않아서 `service.py`/`registry.py`에서
그대로 **import**해 재사용했다. 실제로 새로 작성한 코드는 `_validate_evidence_scope_v2`,
`_unique_sources_v2`, 그리고 이를 감싸는 `_produce` 제너레이터 뼈대(~40줄)뿐이다 — 애초에 우려했던
"스트리밍/타임아웃/취소 처리 통째 복제"보다 훨씬 작은 비용으로 v1 무변경 원칙을 지켰다.

`GmsOpenAIAnswerModelV2`도 동일한 패턴이다: HTTP client 설정·재시도 정책·에러 매핑(`_failure_code`,
`_close_stream_safely`)은 `gms_openai_answer.py`에서 상수/함수를 import해 공유하고, v1 타입에 고정된
`_prompt_payload`만 v2 타입으로 다시 작성했다(`_prompt_payload_v2`).

### 결과

- `app/rag/service.py`, `app/adapters/gms_openai_answer.py`를 포함해 v1 관련 기존 파일은 이번 구현에서
  **한 줄도 수정하지 않았다** — `git status` 기준 전부 신규 파일 추가이거나 `__init__.py`/`wiring.py`/
  `main.py`/`api/rag.py`에 대한 **추가(append)**뿐이다.
- v1/v2 관련 pytest 98건(v1 기존 60건 + v2 신규 28건 + 어댑터 v2 4건 + v1↔v2 동시 배선 회귀 1건 등,
  `test_rag_v2_endpoint.py`/`test_rag_v2_streaming.py`/`test_replay_retrieval.py`/
  `test_gms_openai_answer_v2.py` 신규) 전부 통과, ruff lint 통과.

### 커밋 전 재검증에서 발견·수정한 것 (2026-08-03)

ADR-0037 원문과 대조하며 다시 검증하던 중, `ReplayContext.captions`에 "최대 20개 발화"(item 개수)만
`max_length=20`으로 걸려 있고 "text 합계 최대 6,000자"(전체 글자 수 합) 검증이 빠진 걸 발견했다.
대신 근거 없이 `CaptionContextItem.text`에 항목당 2,000자 상한을 임의로 걸어뒀는데, 이러면 20개 항목이
각각 2,000자씩(최대 40,000자)이어도 통과해버려 ADR-0037의 6,000자 합계 규칙을 실제로는 지키지 못했다.

`app/rag/models.py`의 `ReplayContext`에 `model_validator`를 추가해 `captions`의 `text` 길이 합이
6,000자를 넘으면 계약 위반(`400`)으로 거부하도록 고쳤다. 항목당 개별 상한은 근거가 없어 없애는 대신,
아예 합계 상한과 같은 값(6,000)으로 올려서 "항목 하나가 합계 상한을 넘을 수 없다"는 자명한 제약으로만
남겨뒀다. 회귀 테스트 3개(`test_replay_context_rejects_more_than_20_captions`,
`test_replay_context_rejects_captions_over_6000_char_aggregate_budget`,
`test_replay_context_accepts_captions_exactly_at_6000_char_aggregate_budget`)를
`test_rag_v2_streaming.py`에 추가했다.

# ADR-0004: 핵심 용어 콜백 전달 타이밍 — 별도 콜백 vs 통합 콜백

- **상태**: 제안 — 옵션 정리 완료, 최종 선택 대기
- **일자**: 2026-07-30
- **관련**: [ADR-0003](0003-pptx-key-term-extraction-approach.md),
  `ai/ai-worker/app/consumers/material_job.py`,
  `ai/ai-worker/app/application/index_pptx_material.py`,
  `ai/ai-worker/CONTRACT.md` §9.5/§10

## 맥락 (Context)

`IndexPptxMaterial.execute()`는 embedding과 GMS 핵심 용어 추출을 이미 `asyncio.gather`로 **병렬 실행**한다.
두 작업 모두 끝나야 `execute()`가 `MaterialIndexResult(version_id, key_terms)`를 반환하므로, "두 기능을 병렬로
수행한다"는 조건 자체는 이미 만족돼 있다.

문제는 그 다음이다. 현재 `consumers/material_job.py`의 `MaterialJobHandler.handle()`은 `execute()`가 끝난
뒤 **HTTP 콜백을 두 번, 순서대로** 보낸다.

```text
execute() 완료 (embedding + 용어 추출 둘 다 끝남)
  → POST 콜백 #1: MATERIAL_EMBEDDED (READY)
  → (용어가 있으면) POST 콜백 #2: MATERIAL_KEY_TERMS_EXTRACTED (keyTerms 포함)
```

사용자는 이걸 "두 기능이 완료되면 한 번에 보내는 방식"으로 바꾸고 싶어한다 — 즉 콜백을 두 번 보내지 않고,
하나의 HTTP 요청에 embedding 결과와 용어 결과를 함께 실어서 한 번만 보내는 방식이다.

## 핵심 트레이드오프 (재시도 시 용어 유실 위험)

이 결정에서 가장 중요한 변수는 **재시도(retry) 상황**이다.

- `MATERIAL_EMBEDDED` 콜백은 기존 계약(`ai/ai-worker/CONTRACT.md` §9.5/§9.6)상 **반드시 전달돼야 하는
  필수 신호**다. 전송이 실패하면(`SpringCallbackError(retryable=True)`) `MaterialJobHandler`가 예외를
  올리고, RabbitMQ가 원본 message를 재전달해 job 전체가 재시도된다.
- job이 재시도되면 `IndexPptxMaterial.execute()`는 맨 위의 idempotent 단축 경로(`find_existing`)를 탄다.
  이미 `SUCCEEDED` 상태인 job은 embedding/추출을 다시 하지 않고 저장된 `version_id`만 돌려준다 —
  이건 GPU 재추론을 막기 위한 **의도된 동작**이며 바꾸지 않는다.
- 즉 **재시도 시점에는 `key_terms`를 다시 만들 방법이 없다.** 재시도된 `execute()`는 항상 빈 tuple을
  반환한다.

이 제약 때문에 "한 번에 보내기"를 어떻게 구현하느냐에 따라 결과가 크게 갈린다.

### 옵션 A. 현재 구현 유지 (콜백 2번, 분리)

- `MATERIAL_EMBEDDED`는 지금처럼 강하게 재시도되는 필수 콜백으로 유지한다.
- `MATERIAL_KEY_TERMS_EXTRACTED`는 별도 콜백으로, 실패해도 **재시도하지 않고 로그만 남긴다**
  (best-effort). 실패해도 "이번엔 용어를 못 받았다" 정도로 끝나고, job 전체나 embedding 상태에는
  영향이 없다.
- 단점: HTTP 요청이 2번 나간다. Spring이 한 material에 대해 콜백을 두 번 받는다(순서 보장은 되지만
  하나의 원자적 사건은 아니다).

### 옵션 B. 통합 콜백 + 재시도 시 용어 유실 감수

- `execute()`가 끝나면 embedding 결과와 `key_terms`를 하나의 콜백 event(예: 기존 `MATERIAL_EMBEDDED`에
  optional `keyTerms` 필드를 얹음)로 묶어서 **한 번만** 보낸다.
- 이 통합 콜백이 실패하면 지금처럼 job이 재시도되고, 재시도된 `execute()`는 `key_terms`가 빈 상태로
  돌아오므로 **재전송되는 콜백에는 `keyTerms`가 빠진다.**
- 결과적으로 원래 뽑았던 용어가 **조용히(silent) 사라진다** — Spring은 "재시도해서 이번엔 용어가
  없었다"가 아니라 "이 자료엔 원래 핵심 용어가 없다"고 오인한다. 에러 로그도 안 남고 재시도 자체는
  성공으로 끝나기 때문에 아무도 이 유실을 알아채기 어렵다.
- 장점: 요청이 1번이라 단순하고, "완료되면 한 번에"라는 요구를 문자 그대로 만족한다.

### 옵션 C. 통합 콜백 + 재시도 안전장치 추가

- 옵션 B와 동일하게 하나의 콜백으로 합치되, `execute()`가 만든 `key_terms`를 **재시도 창(window) 동안만
  이라도** 어딘가에 잠깐 보관(예: job_id 기준 in-memory 캐시, 또는 `ai.material_version`에 임시 컬럼)해서
  재시도 시에도 다시 실어 보낼 수 있게 한다.
- 유실 위험은 사라지지만, 캐시/저장소를 새로 설계해야 하므로 구현 규모가 커진다. 프로세스가 재시작되면
  in-memory 캐시는 날아가므로 완벽한 보장은 아니다(DB에 넣으면 완전 보장되지만 그러면 결국 ADR-0003이
  미뤄뒀던 "ai-worker가 용어를 저장할지" 문제로 되돌아간다).

## 비교

| 항목 | A. 분리 유지 | B. 통합 + 유실 감수 | C. 통합 + 안전장치 |
|---|---|---|---|
| HTTP 요청 횟수 | 2번 | 1번 | 1번 |
| 재시도 시 용어 유실 | 없음(애초에 필수 계약이 아님) | 있음(조용히 사라짐) | 없음(별도 저장 필요) |
| 구현 규모 | 완료(변경 없음) | 작음(콜백 모델 합치기만) | 큼(캐시/저장소 신규 설계) |
| 기존 embedding 콜백 신뢰성 | 영향 없음 | 영향 없음(embedding 자체는 그대로 재시도됨) | 영향 없음 |
| Spring이 받는 신호 | 두 사건으로 분리 관측 | 한 사건으로 관측(단, 실패 시 무음 유실) | 한 사건으로 관측 |

## 권고 (Recommendation)

핵심 용어 추출은 ADR-0003에서부터 "선택 기능·best-effort"로 설계됐다. 옵션 B는 이 성격과 반대로,
드물지만 실제로 발생하면 **아무도 모르게 데이터가 사라지는** 실패 모드를 만든다. 반면 옵션 A는 지금
당장 추가 구현이 필요 없고, 실패해도 "안 온 것"으로 명확히 관측된다(로그로 남음).

"한 번에 보내고 싶다"는 요구를 살리려면 옵션 C가 맞는 방향이지만, 그러려면 재시도 창 동안 용어를
어딘가에 잠깐 저장하는 설계가 먼저 필요하다 — 이건 이 ADR의 범위를 넘는 별도 작업이다.

## 결정 (사용자 확인 필요)

ـ A(현재 유지) / B(유실 감수하고 통합) / C(안전장치 만들고 통합) 중 하나를 선택해야 다음 구현으로
넘어갈 수 있다. 아직 선택되지 않았다.

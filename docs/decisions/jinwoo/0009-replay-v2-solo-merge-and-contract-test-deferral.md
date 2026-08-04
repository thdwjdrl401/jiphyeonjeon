# ADR-0009: replay RAG v2 endpoint — 단독 MR 머지 판단과 계약 테스트 위임

- **상태**: 제안
- **일자**: 2026-08-03
- **관련**: [ADR-0037(canola, 요구사항)](../canola/0042-replay-ai-caption-context-contract.md),
  [ADR-0008(jinwoo, 구현 설계)](0008-replay-rag-answer-v2-endpoint.md),
  `docs/harness/POLICY.md`, `docs/CONTRACT.md` §3-9, `ai/ai-api/CONTRACT.md` §8

## 맥락

`/internal/v2/rag/answers:stream`은 Spring↔ai-api 공유 경계를 넘는 내부 HTTP 계약이다. 동일 유형
경계(v1 RAG SSE)에서 필드 누락으로 양쪽이 각자 테스트를 통과했음에도 운영에서 2일간(2026-07-30~08-01)
전부 400으로 죽은 전례가 `docs/CONTRACT.md` §3-9에 기록돼 있다. 그래서 이 경계는 원칙적으로
Spring↔AI 양쪽을 함께 잠그는 계약 테스트 대상이다.

그러나 v2는 브랜치 `feat/ai/replay-rag-answer-v2-endpoint`(커밋 `db35afd`) 시점에 ai-api 쪽만
구현됐고 FE/Spring 구현은 아직 없다. "계약 테스트"는 본질적으로 두 주체가 같은 필드셋을 공유하는지
검증하는 것인데, 한쪽(Spring)이 아직 없으면 지금 시점에 완성될 수 없다.

## 결정

ai-api 쪽만 구현된 현재 상태로 MR을 올린다. 근거:

1. v1 관련 기존 파일을 한 줄도 건드리지 않았다(신규 파일 + 기존 파일 append만) — 회귀 위험이 없다.
2. ai-api 쪽 pytest 28건(`test_rag_v2_endpoint.py` 등)이 요청 필드 검증(`extra="forbid"`)과
   상태코드(200/400/401/406/409/503)를 전부 exercise해 "AI 쪽 절반"의 계약 테스트 역할을 이미
   수행한다.
3. `ai/ai-api/CONTRACT.md` §8에 wire 필드명(`questionSessionMs`, `captions[].startSessionMs/
   endSessionMs`, `excerpt`, CAPTION source가 `sttSessionId`를 포함하지 않는 것 등)을 정본화해
   Spring 구현 시 참조 기준을 남겨뒀다.

단, 다음을 남은 의무로 명시 위임한다.

- 루트 `docs/CONTRACT.md`·`docs/ai/CONTRACT.md` 갱신은 3-오너(FE/Spring/AI) 합의 후 별도 MR에서
  수행한다(jinwoo가 임의로 확정하지 않는다 — CONTRACT.md는 소유 범위 밖, `docs/CONTRACT.md` §6
  계약 변경 절차 위반 방지).
- Spring이 v2 caller를 구현할 때 v1의 `RagAnswerWireContractTest`와 동등한 수준의 wire-field-lock
  테스트(`docs/harness/ENFORCEMENT.md` §C 절차)를 **반드시** 추가한다. 이것이 실제 계약 테스트
  게이트이며, 이번 ai-api 단독 MR은 그 전 단계일 뿐이다.
- 이번 MR 설명에 "AI 쪽 절반만 구현, 루트 CONTRACT.md는 3-오너 합의 후 별도 반영"을 명시해 리뷰어가
  이 상태를 완료로 오인하지 않게 한다.

## 대안 (기각)

| 대안 | 판단 |
|---|---|
| Spring/FE 구현이 끝날 때까지 이 MR을 보류 | 세 오너가 병렬로 작업하기로 한 ADR-0037의 전제(각 오너가 내부 구현을 별도로 진행)와 어긋나고, 회귀 위험이 없는 격리된 변경을 불필요하게 지연시킨다 |
| 지금 루트 `docs/CONTRACT.md`까지 jinwoo가 임의로 갱신 | 팀 컨벤션(오너 합의 선행) 위반, `docs/CONTRACT.md` §6 계약 변경 절차 위반 |

## 영향·후속

- MR 설명에 "AI 쪽 구현만, 루트 CONTRACT.md는 별도 후속" 명시.
- Spring 오너에게 `ai/ai-api/CONTRACT.md` §8과 v2 wire-lock 테스트 필요성을 별도로 전달(이슈/코멘트로).
- Sub Ⅱ 착수 시 `docs/harness/ENFORCEMENT.md`의 G-2(계약 동반수정 검사) glob에
  `ai/ai-api/app/(rag|api)/`를 추가하는 것을 검토한다 — 현재는 `backend/*/request|response`·
  `frontend/src/(store|common)` 경로만 감시해 ai-api 모델 변경은 잡지 못한다. 이번 MR의 블로커는
  아니다.

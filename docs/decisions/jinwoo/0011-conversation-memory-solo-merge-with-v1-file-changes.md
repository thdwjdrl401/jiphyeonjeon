# ADR-0011: GMS 대화 이어가기 — v1 파일 직접 수정 상태의 단독 MR 머지 판단

- **상태**: 제안
- **일자**: 2026-08-03
- **관련**: [ADR-0010](0010-gms-responses-api-conversation-memory.md),
  [ADR-0009(선례, replay v2)](0009-replay-v2-solo-merge-and-contract-test-deferral.md),
  `docs/harness/POLICY.md`, `docs/CONTRACT.md` §3-9, `ai/ai-api/CONTRACT.md` §7-1

## 맥락

ADR-0010은 v1 `RagAnswerRequest`에 optional `userId`/`conversationId`를 추가하려면 v1 기존 파일
(`models.py`·`ports.py`·`service.py`·`gms_openai_answer.py`·`config.py`·`wiring.py`)을 직접
고쳐야 한다고 판단했다. 이는 ADR-0009(replay v2)가 "v1 파일 무변경"을 핵심 회귀-안전 근거로 삼았던
것과 정면으로 다른 상황이다 — 이번엔 v1 파일을 건드렸다. 같은 근거를 재사용할 수 없는 상태에서
"이대로 MR을 올려도 되는가"를 별도로 판단할 필요가 있다.

## 결정

v1 파일을 직접 수정한 현재 상태(브랜치 `feat/ai/gms-conversation-memory`, 커밋 `44979d1`)로 MR을
올린다. 근거:

1. **"파일 무변경" 대신 "wire 동작 무변경"을 근거로 삼는다.** Spring 쪽 wire 생성 지점
   (`backend/.../RagAnswerHttpClient.java`의 `Wire` record, `RagAnswerCommand.java`)은 여전히
   기존 7개 필드만 갖고 있음을 코드로 확인했다 — Spring이 이 MR로 인해 보내는 JSON은 바이트 단위로
   그대로다.
2. **행동 무변경을 실행으로 검증했다.** `GmsOpenAIAnswerModel.stream_answer()`는
   `response_id_capture` kwarg 유무로만 분기하는 얕은 게이트이고, 기존 Chat Completions 경로
   (`_stream_answer`)는 새 Responses API 경로(`_stream_answer_via_responses_api`)와 완전히 분리된
   별도 함수다. pytest 288건 중 기존 테스트가 **전부 무변경으로 통과**했다 — "파일을 안 건드렸다"보다
   강한 증거(파일을 건드렸어도 행동이 실측상 안 바뀌었음을 확인).
3. **optional 필드 설계 자체가 안전장치다.** ADR-0007의 `curriculumId` required 추가 사고
   (`docs/CONTRACT.md` §3-9, 2일간 장애)를 반복하지 않도록 두 필드 모두 optional이고, `pydantic`
   `extra="forbid"` 모델에서 Spring이 필드를 안 보내면 이전과 동일 분기를 탄다.
4. 루트 `docs/CONTRACT.md`는 갱신하지 않는다 — Spring이 아직 필드를 보내지 않아 실제로 넘는 경계가
   없고, 3-오너 합의 전 임의 확정은 §6 절차 위반이다(ADR-0009와 동일 판단). 대신
   `ai/ai-api/CONTRACT.md` §7-1(AI 소유 범위 문서)에 이미 정본화했다.

## POLICY 적용: 계약 테스트 불필요(지금), 조건부 필요(활성화 시점)

`docs/harness/POLICY.md`의 "공유 경계를 넘는가?" 기준에서, 스키마는 공유 경계 파일이지만 **실제로
넘나드는 페이로드가 없다**(Spring 미전송) — 넘지 않는 경계는 지금 잠글 수 없다. Spring이
`userId`/`conversationId`를 실제로 보내기 시작하는 시점이 진짜 활성화 시점이며, 그때:

- `ENFORCEMENT.md` §C 절차로 Spring 쪽 wire-field-lock 계약 테스트를 반드시 추가한다(필드명
  camelCase, optional 생략 동작, curriculumId 사고 재발 방지 패턴).
- `docs/CONTRACT.md` §3-9와 §6에 따라 3-오너 합의 후 루트 CONTRACT.md를 갱신한다.
- ai-api 쪽 `test_gms_openai_answer.py`·`test_rag_streaming.py`의 신규 테스트가 "AI 쪽 절반" 역할을
  선점한다(ADR-0009와 동일 패턴).

## 대안 (기각)

| 대안 | 판단 |
|---|---|
| Spring이 필드를 보내기 시작할 때까지 이 MR 보류 | v1 파일을 직접 고쳤어도 활성 경로 행동이 실측상 무변경임을 이미 검증했다 — 근거 없는 지연 |
| "v1 파일 무변경"(ADR-0009 문구)을 그대로 재사용 | 사실과 다르다(6개 v1 파일을 실제로 고쳤다) — 재사용하면 리뷰어를 오도한다 |
| 지금 루트 CONTRACT.md까지 임의 갱신 | §6 절차 위반, 3-오너 합의 선행 원칙 위반 |

## 영향·후속

- MR 설명에 "v1 파일을 직접 수정했지만 Spring wire는 바이트 단위로 무변경 + 기존 288 pytest 무변경
  통과로 검증"을 명시해, 리뷰어가 ADR-0009와 같은 "파일 무변경" 논리로 오인하지 않게 한다.
- Spring 오너에게 `ai/ai-api/CONTRACT.md` §7-1과 활성화 시 필요한 계약 테스트를 별도 전달.
- 활성화(Spring이 필드 전송 시작) 시점에 이 ADR을 "제안"에서 "구현됨"으로 갱신하고 계약 테스트
  결과를 첨부한다.

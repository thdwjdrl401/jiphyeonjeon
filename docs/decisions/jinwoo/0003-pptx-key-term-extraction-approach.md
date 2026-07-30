# ADR-0003: PPTX 핵심 용어 추출 방식 선택

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택(방식·전달 방식) — 강사 지정 용어 연동만 후속 결정 대기
- **일자**: 2026-07-29 (전달 방식 갱신: 2026-07-30)
- **관련**: `ai/ai-worker/app/application/index_pptx_material.py`,
  `ai/ai-worker/app/ingestion/pptx_parser.py`,
  `frontend/src/features/live-session/liveLearningPreview.ts`(`GlossaryTermView` preview 모델)

## 맥락 (Context)

지금 EC2 ai-worker에 준비 중인 "PPTX 청킹 → GPU 임베딩" 파이프라인과 별개로, PPTX 전체 내용에서
핵심 용어(+정의)를 추출하는 기능을 병렬로 추가하려 한다. `IndexPptxMaterial.execute()`가
`parse_pptx()`로 전체 텍스트(`ParsedPresentation`)를 이미 만들어두는 시점에,
`embedding_model.embed(...)` 호출과 `asyncio.gather`로 동시에 돌리면 전체 처리 시간을 늘리지
않고 추가할 수 있다. 이 ADR이 다루는 범위는 **용어(+정의) 추출까지**이며, 추출된 용어를 다시
설명/활용하는 다운스트림 기능은 범위 밖이다.

## 결정 (Decision)

**A안(GMS/LLM 호출)을 채택한다.** B(BGE 임베딩 기반)·C(순수 통계 기반)는 기각.

### 입력 범위

슬라이드별로 나눠서 여러 번 호출하지 않고, **PPTX 전체 텍스트를 한 번에 묶어서 GMS에 1회 요청**한다.
"전체 내용에서" 핵심 용어를 뽑는다는 요구사항과 맞고, 슬라이드 수만큼 호출이 늘어나는 비용 문제도
피한다. 슬라이드(페이지) 출처를 유지하려면 입력 텍스트에 `[슬라이드N]` 같은 구분자를 넣어 프롬프트에
포함시킨다.

### 출력 형식

구조화된 출력(JSON schema 강제)으로 아래 형태를 받는다. 자유 텍스트로 "JSON으로 답해"라고만
지시하는 방식은 파싱 실패 위험이 있어 사용하지 않는다.

```json
{
  "terms": [
    { "term": "지도학습", "definition": "정답(레이블)이 있는 데이터로 모델을 학습시키는 방식" }
  ]
}
```

### 강사 지정 용어와의 중복 방지

강사가 미리 지정하는 핵심 용어 기능이 별도로 있다(현재 FE preview 목업만 존재,
`GlossaryTermView.source: 'INSTRUCTOR' | 'MATERIAL'`, 실제 백엔드는 아직 없음). AI가 자료에서
추출한 용어(`source: 'MATERIAL'`)가 강사 지정 용어와 같은 목록에 나란히 표시될 예정이므로 중복을
막아야 한다. 2단계로 방어한다.

1. **프롬프트 단계 제외**: GMS 요청 시 "강사가 이미 지정한 용어 목록"을 함께 주고 "이 용어들과
   그 동의어/유사 표현은 제외하고 추출하라"고 지시한다. LLM이 의미 단위로 걸러주므로 완전히
   같은 문자열이 아니어도(예: "SecurityContext" vs "보안 컨텍스트") 걸러질 수 있다.
2. **후처리 안전장치**: GMS가 반환한 용어를 강사 지정 용어와 정규화(대소문자·공백 정리) 후
   문자열 비교해서, 그래도 겹치면 최종적으로 한 번 더 제거한다. 1단계가 놓친 경우의 이중 방어.

**전제 조건(미해결)**: 이 중복 방지가 동작하려면 추출 실행 시점에 "이 lesson/material에 강사가
이미 지정한 용어 목록"을 알아야 한다. 강사 지정 기능의 실제 백엔드가 아직 없으므로, 그 기능이
구현될 때 ai-worker가 이 목록을 어떻게 받는지(Spring이 job과 함께 전달 / ai-worker가 직접 조회)도
같이 정해야 한다. 그 전까지는 중복 방지 없이(또는 이 단계 자체를 건너뛰고) 동작한다.

### 결과 전달 방식 (2026-07-30 갱신, 2026-07-30 재갱신 — ADR-0004)

ai-worker는 추출된 용어를 자체 DB에 저장하지 않는다. 대신 기존 자료 임베딩 완료 통지와 같은 채널
(`POST /api/internal/ai/callbacks`, HMAC 서명)을 재사용해 Spring에 전달한다.

최초 설계는 기존 `MATERIAL_EMBEDDED`(READY) callback을 먼저 보낸 뒤 별도 eventType으로 용어를
추가 전달하는 것이었으나, [ADR-0004](0004-key-term-callback-delivery-timing.md)에서 **하나의
콜백으로 합쳐서 한 번만 보내는 방식(옵션 C)**으로 최종 결정했다. 기존 `MATERIAL_EMBEDDED` event에
optional `keyTerms` 필드를 실어서 보내고, 별도 eventType은 만들지 않는다. 재시도 시 용어가 조용히
사라지는 것을 막기 위해 `IndexPptxMaterial`이 추출 성공 시점의 `key_terms`를 job_id 기준
in-memory 캐시(최대 1,000개)에 잠깐 보관했다가, 같은 프로세스 안에서 재시도가 일어나면 거기서
복원해 다시 실어 보낸다(프로세스 재시작 시에는 이 보호가 사라진다 — ADR-0004 참고).

상세 wire 계약은 [`ai/ai-worker/CONTRACT.md` §10](../../../ai/ai-worker/CONTRACT.md)을 따른다.

실제 저장(Spring `AiCallbackEvent`/`AiCallbackService`에 `keyTerms` 필드 처리와 영속화 로직 추가)은
backend Java 팀의 몫이며 이 ADR의 범위 밖이다. ai-worker 쪽 구현은 통합된 콜백으로 용어를 전달하는
데까지다.

## 근거 (Rationale)

A/B 비교(2026-07-29 검토):

| 항목 | A. GMS(LLM) 호출 | B. BGE 임베딩 기반(KeyBERT 방식) |
|---|---|---|
| 아키텍처 경계 | ai-worker가 지금 GMS를 전혀 모름 — 새 경계를 뚫는 것 | ai-worker가 이미 쓰는 bge-runtime 경계 재사용 |
| 필요한 새 의존성 | GMS API key를 ai-worker에도 주입, `openai` SDK 추가 | 한국어 후보 단어 추출용 형태소 분석기(프로젝트에 전무 — 신규 도입) |
| 품질(한국어 강의자료) | 높음 — 문맥·동의어·중요도까지 이해, 정의문 생성도 같은 호출로 가능 | 중간 — 전처리(형태소 분석) 품질에 좌우, 정의문 생성은 별도 처리 필요 |
| 비용 | 자료 1개당 GMS 요청 1번, 토큰 비용 누적 | 기존 GPU 임베딩 재사용, 추가 비용 없음(후보 단어 임베딩 1회 추가 호출만) |
| 지연시간 | 외부 API 왕복이라 병렬로 돌려도 가장 늦게 끝날 가능성 | 같은 GPU 파이프라인이라 상대적으로 빠름 |
| 일관성/테스트 | 비결정적 출력이라 계약 테스트 까다로움(구조화 출력으로 형식은 보장) | 결정적 출력이라 테스트 쉬움 |
| 보안/신뢰 경계 | 강의자료 원문 전체가 외부 GMS 서버로 나감 | 원문이 외부로 안 나감 |
| 구현 규모 | 작음 — 프롬프트 + GMS client | 큼 — 형태소 분석기 선정·통합, 후보 추출·점수 로직 신규 작성 |

용어뿐 아니라 **정의문까지 같은 호출로 받아야 한다**는 요구사항이 결정적이었다. B는 정의문 생성
기능이 없어(임베딩 유사도로 "중요한 단어"만 고를 뿐) 정의문까지 받으려면 결국 별도 LLM 호출이
또 필요해지므로, 처음부터 A가 구조적으로 더 맞는다.

## 영향·후속 (Consequences)

- **저장 위치는 해결됨(2026-07-30)**: ai-worker는 저장하지 않고 `MATERIAL_KEY_TERMS_EXTRACTED`
  Spring 콜백으로 전달한다(위 "결과 전달 방식" 참고). `MaterialCallbackEvent`는 `extra="forbid"`를
  유지한 채 `keyTerms`를 새 optional field로 추가했고(다른 eventType의 wire 형태는 불변), 실제
  영속화는 backend Java 쪽 후속 구현으로 남는다.
- ai-worker의 신뢰 경계(기존 RabbitMQ·PostgreSQL·Spring·bge-runtime)가 GMS까지 넓어졌다 — 관련
  계약은 [`ai/ai-worker/CONTRACT.md` §10](../../../ai/ai-worker/CONTRACT.md)에 반영했다.
- 강사 지정 용어 기능의 실제 백엔드 설계가 먼저(또는 동시에) 필요 — 이 ADR의 중복 방지 설계는
  그 기능의 데이터 모델(용어 목록을 어떻게 조회하는지)이 정해져야 완성된다. (미해결)
- 용어 개수 제한(슬라이드 수 비례 vs LLM 자율) 결정 미정. (미해결)

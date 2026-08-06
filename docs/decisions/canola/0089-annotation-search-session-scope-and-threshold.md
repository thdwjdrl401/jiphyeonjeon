# ADR-0089: 판서 의미 검색 — 세션 스코프 축소와 유사도 허들

- **상태**: 구현됨
- **일자**: 2026-08-06
- **관련**: [canola/ADR-0043](0043-annotation-timeline-evidence-mvp.md)(판서 근거 MVP — §4 스코프 결정을 이 ADR이 번복),
  [jinwoo/ADR-0007](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)(자료의 커리큘럼 스코프)

## 배경 — 다른 세션의 판서가 매 답변에 딸려 들어왔다

운영에서 "방금 강사님이 뭐에 대해 설명하셨어?" 같은 질문에, 현재 세션과 무관한 **예전 세션의
트랜잭션 격리 수준 판서**가 근거로 반복 등장했다. 같은 질문을 다시 해도 같은 판서·같은 답이
되풀이됐다. 원인은 두 가지가 겹친 것:

1. **커리큘럼 스코프** — ADR-0043 §4는 판서 의미 검색을 자료(ADR-0007)와 같은 `curriculumId`
   축으로 정했다. 같은 커리큘럼을 여러 세션이 재사용하면, 지금 수업과 무관한 과거 세션의 판서가
   정당한 검색 결과로 돌아온다.
2. **허들 부재** — 자료 hit은 `vector_score >= 0.6` 게이트를 거치지만 판서 hit은 점수 검사가
   없었다. SQL이 "있는 것 중 가장 비슷한 top-k"를 돌려줄 뿐 절대 하한이 없어, 질문과 무관해도
   커리큘럼에 판서가 존재하기만 하면 매 질의마다 top-k개가 근거로 들어갔다.

자료는 커리큘럼 공유가 목적(여러 차시가 같은 PPT를 쓴다)이지만, 판서는 "그 수업에서 강사가 강조한
것"이라 세션 문맥이 본질이다. 같은 축을 쓸 이유가 애초에 약했다.

## 결정

### 1. 의미 검색을 질문자의 `sessionId`로 좁힌다 (ADR-0043 §4 번복)

`ANNOTATION_HYBRID_SQL`에 `session_id = :session_id` 술어를 추가한다. `curriculum_id` 술어는
잘못 색인된 행에 대한 심층 방어로 유지한다. recent window는 원래 세션 스코프였으므로 변화 없다.

- 잃는 것: "지난 세션에 강조하신 내용" 질문에 대한 교차 세션 검색. 실사용 시나리오(라이브 중
  질의)에서 관측된 적 없는 유스케이스이고, 필요해지면 명시적 요청 파라미터로 재도입한다.
- v2(다시보기)의 질문 시점 컷오프는 그대로 두되, 세션 스코프가 선행하므로 "다른 세션은 전부
  허용" 분기는 의미를 잃는다(술어는 무해하게 남는다).

### 2. 의미 검색 hit에 벡터 허들을 건다

`AI_API_ANNOTATION_VECTOR_THRESHOLD`(기본 `0.6`, 자료와 동일) 미만의 hit은 근거에서 제외한다.
recent window hit은 시간 기준 선별이라 점수가 없고(`vector_score IS NULL`) 허들을 거치지 않는다 —
"아까 강조하신 게" 질문의 유일한 근거를 임계값이 죽이면 안 된다.

### 3. 스코프 검증 가드도 세션 비교로 강화한다

`_validate_evidence_scope`(v1)·`_validate_evidence_scope_v2`의 ANNOTATION 분기가 이제
`sessionId`까지 비교한다. 스코프 밖 판서가 근거로 돌아오면 검색 계층의 버그이므로
`EVIDENCE_SCOPE_VIOLATION`으로 답변을 거부한다(기존에는 "커리큘럼 검색의 정당한 결과"로 통과).

## 검증

- `test_annotation_retrieval_postgres.py` — 실제 pgvector에서 같은 커리큘럼·다른 세션 판서가
  검색되지 않음, 컷오프는 세션 내 미래만 숨김.
- `test_annotation_evidence_combination.py` — 두 읽기 모두 세션 스코프 전달, 허들 미만 hit 제외
  (live·replay 양쪽), window hit은 threshold=1.0에서도 통과, 경계값 검증.
- `test_rag_streaming.py`·`test_rag_v2_streaming.py` — 다른 세션 annotation 근거는
  `EVIDENCE_SCOPE_VIOLATION` (기존 "accepted" 테스트를 번복).
- `test_deployment_config.py` — compose 두 파일에 `AI_API_ANNOTATION_VECTOR_THRESHOLD` env가
  기본값까지 정확히 매핑됨(env 이름 불일치로 조용히 꺼지는 함정 방지).

## 운영 메모

- 임계값 0.6은 자료와 같은 값으로 시작한다. 임베딩 점수 분포를 실측하기 전의 보수적 선택이며,
  조정은 env로 재배포 없이 가능하다.
- 이미 색인된 과거 세션 판서는 이 변경으로 검색에서 자연히 사라진다 — DB 정리가 필요 없다.

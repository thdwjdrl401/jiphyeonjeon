# ADR-0082: 강의 자료 다운로드는 링크 이동이 아니라 바이트를 받아 저장한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-05
- **관련**: [CONTRACT §수강생 자료 다운로드 접근 계약](../../CONTRACT.md),
  ADR-0035(레슨 자료 연결), songjeongki/0042(커리큘럼 자료), songjeongki/0023(presigned 업로드),
  [ADR-0077](0077-material-integrity-backend-contract-request.md)

## 맥락 (Context)

수강생이 강의 자료(PPTX)를 내려받지 못한다는 보고가 들어왔다. 커리큘럼 공통 자료와 개별 강의 자료
양쪽 모두다. 원인을 나눠 보면 두 겹이다.

**1) 서버 경로가 없었다.** 수강생용 다운로드 엔드포인트(`GET /curriculums/{id}/materials/{mid}/download`,
`GET /lessons/{id}/materials/{mid}/download`)는 `feat/be/curriculum-asset-access`에서 신설됐고
아직 master에 없다. 그전까지 화면은 존재하지 않는 경로를 가리키고 있었다.

**2) 화면이 실패를 삼켰다.** 이쪽이 이 ADR의 대상이다. 다운로드는 `<a href download>` 링크였고,
그 형태에는 구조적인 문제가 셋 있다.

- **실패가 보이지 않는다.** 계약은 비로그인 401, 미수강·승인 대기 403, 범위 밖 자료 404를 준다.
  그런데 링크를 누르면 브라우저가 그 응답을 조용히 버리거나 JSON 오류 본문으로 이동해 버린다.
  수강생 입장에서는 "눌러도 아무 일이 없다"와 "서버가 죽었다"와 "수강 신청이 아직 승인 안 됐다"가
  전부 같은 화면이다.
- **파일명이 망가진다.** 서버는 presigned GET URL로 302를 준다. 그 URL에는 원본 파일명이 없고
  객체 키가 곧 이름이 된다. `download` 속성으로 되돌리려 했지만 이 속성은 최종 응답이 교차 출처면
  무시된다(로컬은 MinIO가 `:9000`이라 해당된다).
- **mock 모드에서 눌러 볼 수 없다.** 링크는 데이터 소스 선택 경계(`selectDataSource`) 밖이라
  `VITE_USE_MOCK_API=true`에서도 그대로 `/api`로 나간다. 즉 "학생 입장에서 되는지"를 로컬에서
  확인할 방법이 없었다.

## 결정 (Decision)

**다운로드를 링크 이동에서 "바이트를 받아 와서 저장"으로 바꾼다.** 다른 API와 똑같이
`materialDownloadService`(interface + mock/http 구현)를 두고 `selectDataSource`로 고른다.

- `httpMaterialDownloadService`는 `apiClient.get(path, { responseType: 'blob' })`으로 받는다.
  XHR이 302를 그대로 따라가므로 최종적으로 스토리지에 닿는다.
- 받은 Blob은 `saveBlob(blob, fileName)`이 objectURL로 감싸 원하는 이름으로 저장시킨다.
  파일명은 화면이 이미 알고 있으므로 presign에 `Content-Disposition`이 없어도 된다.
- 실패는 `useMaterialDownload`가 계약 상태 코드별 문구로 토스트를 띄운다. 401·403·404가 각각
  다른 안내로 나간다.
- 경로 조립(커리큘럼·레슨 × 수강생·강사, 네 갈래)은 `materialDownloadPath` 한 곳으로 모았다.
  화면마다 문자열을 짜맞추면 어긋나도 링크는 멀쩡해 보이고 눌러야 404가 난다.

### `withCredentials: false`로 보내는 이유

이 요청만 자격증명을 끈다. 무심코 켜 두면 **로컬에서만** 깨지는 함정이 있다.

- 첫 요청 `/api/...`는 same-origin이다. same-origin XHR은 이 옵션과 무관하게 쿠키를 싣는다 —
  세션 인증에는 영향이 없다.
- 302를 따라가면 로컬에서는 MinIO(`:9000`)로 넘어간다. 교차 출처다. MinIO는
  `Access-Control-Allow-Origin: *`로 답하는데, 브라우저는 자격증명이 실린 요청에 와일드카드
  허용을 인정하지 않고 응답을 통째로 버린다.
- 운영은 presigned URL도 앱과 같은 도메인이라(`ASSET_STORAGE_ENDPOINT`가 공개 도메인이고 nginx가
  MinIO로 프록시) 애초에 교차 출처가 아니다. 즉 이 설정은 운영을 바꾸지 않고 로컬만 살린다.

## 대안 (Alternatives)

- **링크를 유지하고 서버가 presign에 `Content-Disposition`을 싣게 한다.** 파일명 문제는 풀리지만
  실패를 화면에 드러내는 문제는 그대로다. 백엔드 변경도 필요하다.
- **누르기 전에 권한을 한 번 물어보고 링크로 이동한다.** 요청이 두 번 나가고, 그 사이에 상태가
  바뀌면 여전히 조용히 실패한다.

## 결과 (Consequences)

- 자료 바이트가 메모리를 한 번 거친다. PPTX 기준 수 MB라 문제되지 않지만, 훨씬 큰 파일(녹화 MP4)에
  이 방식을 그대로 쓰면 안 된다 — 영상은 HLS 재생 경로가 따로 있다(songjeongki/0032).
- 타임아웃을 60초로 늘렸다. `apiClient` 기본 15초는 느린 회선에서 큰 자료에 모자란다.
- mock 모드는 자리표시 텍스트를 같은 파일명으로 내려준다. 저장까지 도는지 확인하는 용도이고
  파워포인트로 열리는 문서는 아니다.
- **이 화면은 백엔드 MR(`feat/be/curriculum-asset-access`)이 머지돼야 실제 파일을 받는다.**
  그 전까지 수강생이 누르면 404 안내 토스트가 뜬다 — 예전처럼 조용히 실패하지는 않는다.

## 검증

- `src/test/features/material/materialDownload.test.ts` — 네 갈래 경로, 상태별 안내 문구,
  `saveBlob`의 파일명·objectURL 해제 시점, mock 구현체.
- `CurriculumMaterials.test.tsx` — 자료별 요청 내용, 403 토스트.
- `CurriculumDetailPage.test.tsx`·`CurriculumWorkspace.test.tsx` — 수강생·강사가 각자 경로로 간다.

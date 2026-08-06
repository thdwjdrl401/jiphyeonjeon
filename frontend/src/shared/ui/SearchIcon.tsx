/**
 * 검색창의 돋보기. 세 화면(커리큘럼 탐색·내 커리큘럼·핵심 용어)이 같은 그림을 쓰기 때문에
 * 컴포넌트로 둔다 — 같은 SVG를 세 번 적어 두면 한쪽만 고쳐져 모양이 갈린다.
 *
 * <p>색·굵기·크기는 그리지 않는다. `.search-field svg`가 문맥별로 정하고(도구줄은 17px,
 * 사이드바는 더 작다), 여기서 stroke를 박으면 그 조정이 막힌다.
 *
 * <p><b>aria-hidden</b>이 핵심이다. 이 그림에는 정보가 없고 옆 입력칸의 라벨이 이미 "검색"을
 * 말한다 — 빼면 스크린 리더가 라벨 이름에 이 svg를 섞어 읽는다.
 */
export default function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  )
}

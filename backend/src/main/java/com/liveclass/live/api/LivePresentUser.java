package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 지금 라이브 강의실에 들어와 있는 사람 하나. live가 밖으로 공개하는 경계 DTO다.
 *
 * <p><b>이름이 없다.</b> 여기서 아는 것은 id뿐이고, 표시 이름은 auth가 안다 — 부르는 쪽이 붙인다.
 * 접속 집계에 사용자 조회를 끌어들이면 매 접속·이탈마다 auth를 때리게 된다.
 *
 * @param instructor 강사인가. 화면이 "듣는 사람"과 "진행하는 사람"을 갈라 보여야 한다 —
 *                   {@code audienceCount}가 강사를 빼고 세는 것과 같은 구분이다
 * @param since      이 사람이 들어온 시각. 같은 사람이 탭을 여러 개 열었으면 <b>가장 이른</b> 시각이다
 */
public record LivePresentUser(UUID userId, boolean instructor, OffsetDateTime since) {
}

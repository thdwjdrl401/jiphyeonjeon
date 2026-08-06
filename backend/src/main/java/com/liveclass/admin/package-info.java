/**
 * 운영 콘솔 전용 <b>조합</b> 모듈.
 *
 * <p>여기에는 도메인이 없다. 운영자가 한 화면에서 판단할 수 있도록 다른 모듈의 포트를 모아 붙이는
 * 일만 한다. 그래서 이 모듈은 <b>아무도 의존하지 않는다</b> — 잎사귀로 남겨 두면 여기에 무엇을
 * 더 붙여도 도메인 모듈의 경계가 흔들리지 않는다.
 *
 * <p><b>왜 기존 모듈에 넣지 않았나.</b> 세션 이름표는 live(세션) + lesson(강의 제목) +
 * curriculum(커리큘럼 제목)을 함께 읽어야 한다. 그런데 {@code curriculum → live} 의존이 이미
 * 있어서(다음 예정 라이브 조회) live 안에서 curriculum을 읽으면 <b>순환</b>이 된다. 조합하는 쪽을
 * 밖으로 빼는 것이 Modulith에서의 정답이고, 운영 콘솔은 원래 그 성격이다.
 *
 * <p>기존 관리 endpoint({@code LiveAdminController}·{@code EgressAdminController})는 각자 자리에
 * 그대로 둔다 — 옮기면 이번 변경이 이름표 하나가 아니라 리팩터링이 된다.
 */
package com.liveclass.admin;

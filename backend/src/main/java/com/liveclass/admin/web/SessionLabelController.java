package com.liveclass.admin.web;

import com.liveclass.admin.service.SessionLabelService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 운영 콘솔의 세션 이름표.
 *
 * <p>콘솔은 갇힌 세션과 진행 중 Egress를 UUID로만 보여 줬다. 어느 강의인지 모르면 강제 정지를
 * 누를지 말지 판단할 수 없다. 화면이 표를 그리면서 필요한 id를 모아 한 번에 물어본다.
 *
 * <p><b>기존 관리 endpoint의 응답을 넓히지 않았다.</b> {@code /api/admin/live/summary}와
 * {@code /api/admin/egress}는 각자 다른 것(상태 집계·LiveKit 실시간 목록)을 보고 있고, 거기에
 * 이름표를 얹으면 두 응답이 같은 조회를 각자 하게 된다. 이름표는 별도 조회로 두고 화면이 붙인다.
 *
 * <p><b>조회지만 POST다.</b> 세션 id 여러 개를 쿼리스트링에 늘어놓으면 URL 길이 상한에 걸리고
 * 접근 로그가 id로 뒤덮인다.
 *
 * <p>권한은 {@code /api/admin/**}(ROLE_ADMIN)이 건다(SecurityConfig). <b>여기서 도메인 게이트를
 * 우회하지 않는다</b> — 돌려주는 것은 제목과 id뿐이고, 화면이 거는 링크도 공개 커리큘럼 페이지다.
 */
@Tag(name = "운영 콘솔", description = "운영자가 화면에서 판단하는 데 필요한 조합 조회.")
@RestController
public class SessionLabelController {

    /** 콘솔 표 한 화면 분량. 넘겨받은 만큼 조회하므로 상한을 둔다. */
    private static final int MAX_IDS = 200;

    private final SessionLabelService sessionLabelService;

    public SessionLabelController(SessionLabelService sessionLabelService) {
        this.sessionLabelService = sessionLabelService;
    }

    @Operation(summary = "세션 이름표 일괄 조회",
            description = "세션 id 목록을 주면 강의·커리큘럼 제목을 돌려준다. 못 찾은 id도 빈 값으로 함께 온다.")
    @PostMapping("/api/admin/session-labels")
    public List<SessionLabelService.SessionLabel> labels(@Valid @RequestBody LabelsRequest request) {
        return sessionLabelService.labelsFor(request.sessionIds());
    }

    public record LabelsRequest(
            @NotEmpty @Size(max = MAX_IDS) List<UUID> sessionIds) {
    }
}

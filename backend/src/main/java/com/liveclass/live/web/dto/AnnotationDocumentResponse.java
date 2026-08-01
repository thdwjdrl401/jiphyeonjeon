package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 저장된 판서 문서(CONTRACT §3-6b). 강사가 새로고침 뒤 이걸로 복원한다.
 *
 * <p>서버는 op를 접지 않고 <b>마지막 스냅샷 + 그 이후 op</b>를 그대로 준다. 접는 로직은 이미 FE에
 * 있고(수신 측이 늘 하는 일이다), 서버가 따로 구현하면 두 곳이 갈릴 여지가 생긴다.
 */
@Schema(description = "저장된 판서 문서. 마지막 스냅샷과 그 이후 op를 그대로 돌려준다.")
public record AnnotationDocumentResponse(

        @Schema(description = "이 문서가 반영한 마지막 op 번호.", example = "42")
        long revision,

        @Schema(description = "강사가 이어서 채번할 번호. 새로고침해도 revision이 역행하지 않게 한다.",
                example = "43")
        long nextRevision,

        @Schema(description = "마지막 스냅샷 본문(JSON). 스냅샷이 아직 없으면 null.")
        String snapshotPayload,

        @Schema(description = "스냅샷 이후의 op들. revision 오름차순.")
        List<Op> ops,

        /*
         * 표시 상태를 여기 함께 싣는 이유는 왕복을 하나로 줄이기 위해서다. 복원할 때 어차피 이
         * 응답을 받으므로 세션을 따로 조회할 이유가 없다.
         *
         * <p><b>op가 아니다.</b> 저장은 세션(`live_session.annotation_visible`)에 있고, 위 `ops`를
         * 접는 과정에 끼어들지 않는다 — ADR-0056이 기각한 것은 "표시 상태를 문서 fold에 넣는 것"이지
         * 같은 응답에 실어 보내는 것이 아니다.
         */
        @Schema(description = "판서를 수강생 화면에 표시 중인가(ADR-0056). 문서 내용이 아니라 세션의 표시 상태.")
        boolean visible) {

    @Schema(description = "판서 op 하나.")
    public record Op(long revision, String opType, String payload) {
    }
}

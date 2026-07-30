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
        List<Op> ops) {

    @Schema(description = "판서 op 하나.")
    public record Op(long revision, String opType, String payload) {
    }
}

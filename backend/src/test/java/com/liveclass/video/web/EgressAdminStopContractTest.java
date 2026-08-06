package com.liveclass.video.web;

import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import com.liveclass.video.service.EgressOrphanPurge;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 운영 콘솔 ↔ 서버 계약: <b>정지가 되지 않은 것과 요청이 실패한 것은 다른 사건이다.</b>
 *
 * <p>전에는 이 엔드포인트가 204만 돌려주고, 정지되지 않는 경우를 전부 502로 던졌다. 그 결과
 * 콘솔은 성격이 다른 둘을 똑같이 "정지에 실패했습니다"로 보여 줬다 — 이미 끝나서 할 일이 없는 것과,
 * 소유 노드가 사라져 영영 안 되는 것이다. 앞의 것은 멀쩡한 조작에 빨간불을 띄우는 것이고,
 * 뒤의 것은 운영자에게 무엇을 해야 하는지 알려 주지 않는다(다시 눌러도 결과가 같다).
 *
 * <p>그래서 결말을 200 본문의 {@code outcome}으로 내리고, 502는 <b>LiveKit과 말이 안 통한 경우</b>로만
 * 남긴다. 이 테스트가 그 경계를 고정한다.
 */
@WebMvcTest(EgressAdminController.class)
@AutoConfigureMockMvc(addFilters = false)
class EgressAdminStopContractTest {

    private static final String EGRESS_ID = "EG_6Snga2gnG7Bg";
    private static final String STOP_URL = "/api/admin/egress/" + EGRESS_ID + "/stop";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private EgressControl egressControl;

    @MockitoBean
    private EgressOrphanPurge orphanPurge;

    @Test
    void 정지되면_STOPPED를_돌려준다() throws Exception {
        when(egressControl.stopRecording(EGRESS_ID)).thenReturn(EgressControl.StopOutcome.STOPPED);

        mockMvc.perform(post(STOP_URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("STOPPED"));
    }

    /**
     * 이미 끝난 작업에 정지를 거는 것은 <b>오류가 아니다.</b> 중복 정지는 멱등해야 하고, 운영자가
     * 목록을 보고 누른 시점과 작업이 끝난 시점이 겹치는 일은 정상적으로 일어난다.
     */
    @Test
    void 이미_끝난_작업은_오류가_아니라_ALREADY_ENDED다() throws Exception {
        when(egressControl.stopRecording(EGRESS_ID)).thenReturn(EgressControl.StopOutcome.ALREADY_ENDED);

        mockMvc.perform(post(STOP_URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("ALREADY_ENDED"));
    }

    /**
     * <b>이 케이스가 이 변경의 이유다.</b> 소유 노드가 사라진 유령은 이 경로로 영영 정지되지 않는다.
     * 그것을 502로 올리면 "서버가 잠깐 이상한가?"로 읽혀 운영자가 같은 버튼을 반복해서 누른다.
     * 200 + ORPHANED로 내려야 콘솔이 "다시 눌러도 같다, 수동 정리가 필요하다"고 말할 수 있다.
     */
    @Test
    void 소유_노드가_사라진_유령은_오류가_아니라_ORPHANED다() throws Exception {
        when(egressControl.stopRecording(EGRESS_ID)).thenReturn(EgressControl.StopOutcome.ORPHANED);

        mockMvc.perform(post(STOP_URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("ORPHANED"));
    }

    /** 502는 LiveKit과 말이 안 통한 경우에만 남는다 — 이건 우리 버그가 아니라 업스트림 문제다. */
    @Test
    void LiveKit_통신_실패는_그대로_502다() throws Exception {
        when(egressControl.stopRecording(EGRESS_ID))
                .thenThrow(new EgressControlException("Egress 중지 통신 실패: " + EGRESS_ID));

        mockMvc.perform(post(STOP_URL))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("EGRESS_CONTROL_FAILED"));
    }

    private static final String PURGE_URL = "/api/admin/egress/" + EGRESS_ID + "/purge";

    /** 유령이 확인되면 회수 중계를 불러 기록을 지운다 — 콘솔 버튼이 실제로 걷어내는 경로다. */
    @Test
    void 유령이면_회수한다() throws Exception {
        when(orphanPurge.isAvailable()).thenReturn(true);
        when(egressControl.stopRecording(EGRESS_ID)).thenReturn(EgressControl.StopOutcome.ORPHANED);

        mockMvc.perform(post(PURGE_URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.purged").value(true));

        verify(orphanPurge).purgeOrphan(EGRESS_ID);
    }

    /**
     * <b>살아 있는 녹화는 지우지 않는다.</b> 기록을 지우면 그 녹화가 완료 보고할 곳을 잃는다.
     * 정지가 되었다는 것은 소유자가 있다는 뜻이므로 유령이 아니다.
     */
    @Test
    void 정지되는_작업은_회수하지_않는다() throws Exception {
        when(orphanPurge.isAvailable()).thenReturn(true);
        when(egressControl.stopRecording(EGRESS_ID)).thenReturn(EgressControl.StopOutcome.STOPPED);

        mockMvc.perform(post(PURGE_URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.purged").value(false))
                .andExpect(jsonPath("$.outcome").value("STOPPED"));

        verify(orphanPurge, never()).purgeOrphan(EGRESS_ID);
    }

    /** 중계가 없는 배포(로컬·dev)에서는 조용히 성공하지 않고 그렇게 말한다. */
    @Test
    void 회수_중계가_없으면_502로_알린다() throws Exception {
        when(orphanPurge.isAvailable()).thenReturn(false);

        mockMvc.perform(post(PURGE_URL))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("EGRESS_CONTROL_FAILED"));

        verify(egressControl, never()).stopRecording(EGRESS_ID);
    }
}

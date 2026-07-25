package com.liveclass.lesson;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.lesson.api.MaterialAlreadyAttachedException;
import com.liveclass.lesson.repository.MaterialAssetRepository;
import com.liveclass.lesson.service.LessonMaterialService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * LessonMaterialService의 동시 중복 attach 방어(ADR-0034)를 단위 테스트한다.
 *
 * <p>사전 조회(exists)만으로는 두 요청이 동시에 통과한 뒤 둘 다 저장을 시도하는 레이스를 못 잡는다 —
 * 그 경우를 HTTP 계약 테스트로 결정론적으로 재현하기는 어려워(진짜 스레드 경합·타이밍 의존) 리포지토리를
 * 모킹해 "사전 조회는 통과했지만 저장 시점에 uq_material_active(V5)가 위반된" 상황을 직접 만든다.
 * 이 테스트가 확인하는 것은 그 DataIntegrityViolationException이 500이 아니라 도메인 예외
 * (컨트롤러가 409로 매핑하는 MaterialAlreadyAttachedException)로 바뀌어 나가는지다.
 */
@ExtendWith(MockitoExtension.class)
class LessonMaterialServiceTest {

    @Mock
    private MaterialAssetRepository materialAssetRepository;

    @Mock
    private AssetDirectory assetDirectory;

    @Test
    void attach_converts_constraint_violation_to_domain_conflict() {
        UUID lessonId = UUID.randomUUID();
        UUID assetId = UUID.randomUUID();
        UUID instructorId = UUID.randomUUID();

        when(assetDirectory.find(assetId)).thenReturn(Optional.of(
                new AssetRef(assetId, "MATERIAL", "UPLOADED", instructorId, "deck.pptx", 1024L)));
        // 사전 조회 시점엔 아직 없다고 응답(레이스의 앞부분) — 그런데 동시에 다른 요청이 먼저 커밋해
        // 저장 시점에 uq_material_active 위반이 터지는 상황을 아래 saveAndFlush 스텁으로 흉내낸다.
        when(materialAssetRepository.existsByLessonIdAndAssetIdAndStatus(eq(lessonId), eq(assetId), any()))
                .thenReturn(false);
        when(materialAssetRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint \"uq_material_active\""));

        LessonMaterialService service = new LessonMaterialService(materialAssetRepository, assetDirectory);

        assertThatThrownBy(() -> service.attach(lessonId, assetId, instructorId))
                .isInstanceOf(MaterialAlreadyAttachedException.class);
    }
}

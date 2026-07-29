package com.liveclass.lesson.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.common.logging.Audit;
import com.liveclass.lesson.api.CurriculumMaterialManagement;
import com.liveclass.lesson.api.MaterialAlreadyAttachedException;
import com.liveclass.lesson.api.MaterialAssetInvalidException;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.lesson.domain.MaterialAsset;
import com.liveclass.lesson.domain.MaterialEmbeddingStatus;
import com.liveclass.lesson.domain.MaterialStatus;
import com.liveclass.lesson.repository.MaterialAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * CurriculumMaterialManagement 구현(ADR-0042). LessonMaterialService와 대칭 — 에셋 유효성 검증과
 * 연결 레코드 저장·조회만 하고, 커리큘럼 소유권은 호출자(curriculum)가 책임진다. 같은 material_asset
 * 테이블을 curriculum_id 스코프로 재사용한다. 에셋은 asset.api 포트로만 참조한다(모듈 경계).
 */
@Service
public class CurriculumMaterialService implements CurriculumMaterialManagement {

    private static final Logger log = LoggerFactory.getLogger(CurriculumMaterialService.class);

    private final MaterialAssetRepository materialAssetRepository;
    private final AssetDirectory assetDirectory;

    public CurriculumMaterialService(MaterialAssetRepository materialAssetRepository, AssetDirectory assetDirectory) {
        this.materialAssetRepository = materialAssetRepository;
        this.assetDirectory = assetDirectory;
    }

    @Override
    @Transactional
    public MaterialView attach(UUID curriculumId, UUID assetId, UUID requesterId) {
        AssetRef asset = requireValidMaterialAsset(assetId, requesterId);
        // fast path — 대부분의 중복은 여기서 걸린다. 동시 요청 레이스는 아래 부분 유니크
        // 인덱스(uq_curriculum_material_active, V8)가 최종 방어선이다(레슨 attach와 같은 패턴).
        if (materialAssetRepository.existsByCurriculumIdAndAssetIdAndStatus(curriculumId, assetId, MaterialStatus.ACTIVE)) {
            throw new MaterialAlreadyAttachedException("이미 이 커리큘럼에 연결된 자료입니다.");
        }

        MaterialAsset material = new MaterialAsset();
        material.setCurriculumId(curriculumId);
        material.setAssetId(assetId);
        material.setStatus(MaterialStatus.ACTIVE);
        // 임베딩은 서비스(curriculum)가 파이프라인 켜짐 시 PENDING으로 전환·발행한다. 기본은 READY(무회귀).
        material.setEmbeddingStatus(MaterialEmbeddingStatus.READY);
        MaterialAsset saved;
        try {
            saved = materialAssetRepository.saveAndFlush(material);
        } catch (DataIntegrityViolationException e) {
            throw new MaterialAlreadyAttachedException("이미 이 커리큘럼에 연결된 자료입니다.");
        }

        log.info(Audit.MARKER, "커리큘럼 자료 연결 curriculumId={} assetId={} materialId={}",
                curriculumId, assetId, saved.getId());
        return toView(saved, asset.fileName(), asset.sizeBytes());
    }

    @Override
    @Transactional(readOnly = true)
    public List<MaterialView> findActiveByCurriculum(UUID curriculumId) {
        List<MaterialAsset> materials = materialAssetRepository
                .findByCurriculumIdAndStatusOrderByCreatedAtAsc(curriculumId, MaterialStatus.ACTIVE);
        Map<UUID, AssetRef> assets = assetDirectory.findRefs(
                materials.stream().map(MaterialAsset::getAssetId).toList());
        return materials.stream().map(m -> toViewResolvingAsset(m, assets)).toList();
    }

    @Override
    @Transactional
    public void detach(UUID curriculumId, UUID materialId) {
        // 멱등 소프트 삭제 — 그 커리큘럼의 활성 연결일 때만 DELETED로. 없음·이미 삭제·다른 스코프면 무시.
        materialAssetRepository.findById(materialId)
                .filter(m -> curriculumId.equals(m.getCurriculumId()) && m.getStatus() == MaterialStatus.ACTIVE)
                .ifPresent(m -> {
                    m.setStatus(MaterialStatus.DELETED);
                    log.info(Audit.MARKER, "커리큘럼 자료 연결 해제 curriculumId={} materialId={}", curriculumId, materialId);
                });
    }

    @Override
    @Transactional
    public void updateEmbeddingStatus(UUID materialId, String embeddingStatus) {
        MaterialEmbeddingStatus target = MaterialEmbeddingStatus.valueOf(embeddingStatus);
        materialAssetRepository.findById(materialId)
                .ifPresent(m -> {
                    m.setEmbeddingStatus(target);
                    log.info(Audit.MARKER, "커리큘럼 자료 임베딩 상태 갱신 materialId={} status={}", materialId, target);
                });
    }

    /** 에셋이 존재하고 kind=MATERIAL, 업로드 완료(UPLOADED), 요청자가 업로더인지 검증한다(레슨과 동일 규칙). */
    private AssetRef requireValidMaterialAsset(UUID assetId, UUID requesterId) {
        AssetRef ref = assetDirectory.find(assetId)
                .orElseThrow(() -> new MaterialAssetInvalidException("자료 에셋을 찾을 수 없습니다."));
        if (!"MATERIAL".equals(ref.kind())
                || !"UPLOADED".equals(ref.status())
                || !Objects.equals(requesterId, ref.uploadedBy())) {
            throw new MaterialAssetInvalidException("유효하지 않은 자료 에셋입니다.");
        }
        return ref;
    }

    private MaterialView toViewResolvingAsset(MaterialAsset material, Map<UUID, AssetRef> assets) {
        AssetRef ref = assets.get(material.getAssetId());
        if (ref == null) {
            log.warn("커리큘럼 자료 연결의 에셋을 해석하지 못함 materialId={} assetId={} — 삭제된 에셋일 수 있음",
                    material.getId(), material.getAssetId());
            return toView(material, null, 0L);
        }
        return toView(material, ref.fileName(), ref.sizeBytes());
    }

    private MaterialView toView(MaterialAsset material, String fileName, long fileSize) {
        return new MaterialView(
                material.getId(),
                material.getAssetId(),
                fileName,
                fileSize,
                material.getStatus().name(),
                material.getEmbeddingStatus() == null ? null : material.getEmbeddingStatus().name());
    }
}

package com.liveclass.lesson.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.common.logging.Audit;
import com.liveclass.lesson.api.LessonMaterialManagement;
import com.liveclass.lesson.api.MaterialAlreadyAttachedException;
import com.liveclass.lesson.api.MaterialAssetInvalidException;
import com.liveclass.lesson.api.MaterialView;
import com.liveclass.lesson.domain.MaterialAsset;
import com.liveclass.lesson.domain.MaterialStatus;
import com.liveclass.lesson.repository.MaterialAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * LessonMaterialManagement 구현. 에셋 유효성 검증(kind=MATERIAL·업로드 완료·업로더)과 연결 레코드
 * 저장·조회만 한다 — 레슨 소유권은 호출자(curriculum) 책임이다. 에셋은 asset.api 포트로만 참조하고
 * 엔티티에는 접근하지 않는다(모듈 경계). 연결 응답의 fileName·fileSize는 에셋 참조에서 옮긴다.
 */
@Service
public class LessonMaterialService implements LessonMaterialManagement {

    private static final Logger log = LoggerFactory.getLogger(LessonMaterialService.class);

    private final MaterialAssetRepository materialAssetRepository;
    private final AssetDirectory assetDirectory;

    public LessonMaterialService(MaterialAssetRepository materialAssetRepository, AssetDirectory assetDirectory) {
        this.materialAssetRepository = materialAssetRepository;
        this.assetDirectory = assetDirectory;
    }

    @Override
    @Transactional
    public MaterialView attach(UUID lessonId, UUID assetId, UUID requesterId) {
        AssetRef asset = requireValidMaterialAsset(assetId, requesterId);
        // DDL에 uq(lesson_id, asset_id)가 없어 같은 자료 중복 연결을 앱에서 우선 막는다(사전 조회,
        // fast path — 대부분의 중복 요청은 여기서 걸린다). 동시 요청 레이스는 사전 조회만으로 못 잡으므로
        // DB의 부분 유니크 인덱스(uq_material_active, V5)가 최종 방어선이다 — 아래 catch가 그 위반을 변환한다.
        if (materialAssetRepository.existsByLessonIdAndAssetIdAndStatus(lessonId, assetId, MaterialStatus.ACTIVE)) {
            throw new MaterialAlreadyAttachedException("이미 이 레슨에 연결된 자료입니다.");
        }

        MaterialAsset material = new MaterialAsset();
        material.setLessonId(lessonId);
        material.setAssetId(assetId);
        material.setStatus(MaterialStatus.ACTIVE);
        MaterialAsset saved;
        try {
            // saveAndFlush로 여기서 즉시 제약을 때려 잡는다 — save()만 쓰면 flush가 트랜잭션 끝까지
            // 미뤄질 수 있어 위반이 커밋 시점(컨트롤러 밖)에서야 터진다.
            saved = materialAssetRepository.saveAndFlush(material);
        } catch (DataIntegrityViolationException e) {
            // uq_material_active 위반 = 동시 요청이 먼저 커밋한 경우. rollback-only로 오염되기 전에
            // 도메인 예외로 바꿔 컨트롤러 409로 정상 도달시킨다(0033의 북마크 중복과 같은 이유).
            throw new MaterialAlreadyAttachedException("이미 이 레슨에 연결된 자료입니다.");
        }

        log.info(Audit.MARKER, "자료 연결 lessonId={} assetId={} materialId={}", lessonId, assetId, saved.getId());
        return toView(saved, asset.fileName(), asset.sizeBytes());
    }

    @Override
    @Transactional(readOnly = true)
    public List<MaterialView> findActiveByLesson(UUID lessonId) {
        List<MaterialAsset> materials = materialAssetRepository
                .findByLessonIdAndStatusOrderByCreatedAtAsc(lessonId, MaterialStatus.ACTIVE);
        Map<UUID, AssetRef> assets = assetDirectory.findRefs(
                materials.stream().map(MaterialAsset::getAssetId).toList());
        return materials.stream().map(m -> toViewResolvingAsset(m, assets)).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<MaterialView>> findActiveByLessons(Collection<UUID> lessonIds) {
        if (lessonIds == null || lessonIds.isEmpty()) {
            return Map.of();
        }
        List<MaterialAsset> materials = materialAssetRepository
                .findByLessonIdInAndStatusOrderByCreatedAtAsc(lessonIds, MaterialStatus.ACTIVE);
        // 레슨별로 흩어진 연결 레코드 전체의 에셋을 한 번에 배치 해석한다(N+1 회피).
        Map<UUID, AssetRef> assets = assetDirectory.findRefs(
                materials.stream().map(MaterialAsset::getAssetId).toList());
        return materials.stream()
                .collect(Collectors.groupingBy(
                        MaterialAsset::getLessonId,
                        Collectors.mapping(m -> toViewResolvingAsset(m, assets), Collectors.toList())));
    }

    /** 에셋이 존재하고 kind=MATERIAL, 업로드 완료(UPLOADED), 요청자가 업로더인지 검증한다. */
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

    /** 목록 조회용 — 배치 해석된 에셋 맵에서 파일명·크기를 채운다. 못 찾으면 조용히 넘기지 않고 WARN. */
    private MaterialView toViewResolvingAsset(MaterialAsset material, Map<UUID, AssetRef> assets) {
        AssetRef ref = assets.get(material.getAssetId());
        if (ref == null) {
            log.warn("자료 연결의 에셋을 해석하지 못함 materialId={} assetId={} — 삭제된 에셋일 수 있음",
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
                material.getStatus().name());
    }
}

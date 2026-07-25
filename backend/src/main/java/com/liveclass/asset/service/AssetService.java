package com.liveclass.asset.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.asset.config.AssetStorageProperties;
import com.liveclass.asset.domain.Asset;
import com.liveclass.asset.domain.AssetKind;
import com.liveclass.asset.domain.AssetStatus;
import com.liveclass.asset.repository.AssetRepository;
import com.liveclass.common.logging.Audit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 에셋 발급·완료·해석. presigned direct-to-storage 업로드: 백엔드가 PUT URL을 서명해 주고,
 * 클라이언트가 스토리지로 직접 올린 뒤 완료를 통지한다(바이트는 이 서버를 거치지 않는다).
 * 다른 모듈에는 AssetDirectory 포트로만 노출한다 — asset은 curriculum/auth를 모른다(uploadedBy는 bare UUID).
 */
@Service
public class AssetService implements AssetDirectory {

    private static final Logger log = LoggerFactory.getLogger(AssetService.class);

    /** 이미지 에셋 허용 content-type(THUMBNAIL·PROFILE_IMAGE 공통). */
    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of("image/jpeg", "image/png", "image/webp");

    /** 이미지 업로드 최대 크기 5 MiB(THUMBNAIL·PROFILE_IMAGE). */
    private static final long MAX_IMAGE_SIZE_BYTES = 5L * 1024 * 1024;

    /** 자료(MATERIAL) 허용 content-type — PPTX만(ADR-0034). */
    private static final String MATERIAL_CONTENT_TYPE =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    /** 자료 업로드 최대 크기 50 MiB(ADR-0034). */
    private static final long MAX_MATERIAL_SIZE_BYTES = 50L * 1024 * 1024;

    private final AssetRepository assetRepository;
    private final AssetStorage storage;
    private final AssetStorageProperties props;

    public AssetService(AssetRepository assetRepository, AssetStorage storage, AssetStorageProperties props) {
        this.assetRepository = assetRepository;
        this.storage = storage;
        this.props = props;
    }

    /**
     * 업로드 티켓 발급: 검증 → PENDING 에셋 저장(id 확보) → objectKey 확정 → presigned PUT URL.
     * objectKey는 kind별 폴더 + id로 정해 버킷 내 충돌을 피한다.
     */
    @Transactional
    public AssetUploadTicket createUploadRequest(AssetKind kind, String fileName, String contentType,
                                                 long fileSize, UUID uploaderId) {
        validateUploadRequest(kind, contentType, fileSize);

        Asset asset = new Asset();
        asset.setKind(kind);
        asset.setBucket(props.getBucket());
        asset.setStatus(AssetStatus.PENDING);
        asset.setUploadedBy(uploaderId);
        asset.setOriginalFilename(fileName);
        asset.setContentType(contentType);
        asset.setSizeBytes(fileSize);
        // objectKey는 발급받은 id로 정하는데(kind/id), 그러려면 먼저 저장해 id를 얻어야 한다.
        // Hibernate의 insert 액션은 persist 시점의 필드 스냅샷으로 INSERT를 실행하므로, 그 시점에
        // object_key가 null이면 나중 flush에서 NOT NULL 위반이 난다. 유니크한 임시값을 미리 넣어
        // INSERT(NOT NULL·UNIQUE)를 통과시키고, id 확보 후 실제 키로 갱신한다(같은 flush의 UPDATE).
        asset.setObjectKey("pending/" + UUID.randomUUID());
        Asset saved = assetRepository.save(asset);

        String objectKey = kind.name().toLowerCase() + "/" + saved.getId();
        saved.setObjectKey(objectKey);
        assetRepository.save(saved);

        AssetStorage.PresignedUpload presigned = storage.presignUpload(
                objectKey, contentType, fileSize, Duration.ofSeconds(props.getUploadTtlSeconds()));

        log.info(Audit.MARKER, "에셋 업로드 요청 assetId={} kind={} uploaderId={}", saved.getId(), kind, uploaderId);
        return new AssetUploadTicket(
                saved.getId(),
                presigned.url(),
                "PUT",
                Map.of("Content-Type", contentType),
                presigned.expiresAt());
    }

    /**
     * 업로드 완료 통지: 소유자만, 스토리지에 바이트가 실제로 올라왔는지 확인한 뒤 UPLOADED로 전이.
     * 이미 UPLOADED면 멱등하게 통과한다(재시도 안전).
     */
    @Transactional
    public void complete(UUID assetId, UUID requesterId) {
        Asset asset = assetRepository.findById(assetId)
                .orElseThrow(() -> new AssetNotFoundException("에셋을 찾을 수 없습니다."));
        UUID uploadedBy = asset.getUploadedBy();
        if (uploadedBy == null || !uploadedBy.equals(requesterId)) {
            // uploaded_by는 nullable 컬럼이라 null이면 NPE 대신 403(업로더 없음 = 소유권 없음)으로 막는다.
            throw new AssetForbiddenException("이 에셋의 업로더가 아닙니다.");
        }
        if (asset.getStatus() == AssetStatus.UPLOADED) {
            return;
        }
        // 스토리지의 실제 객체를 확인한다 — 존재 여부만이 아니라 실제 크기·형식까지 검증한다.
        // (클라가 티켓엔 "png 1MB"로 신고하고 실제로는 거대/비이미지 바이트를 올리는 남용을 차단.)
        AssetStorage.StoredObject head = storage.head(asset.getObjectKey())
                .orElseThrow(() -> new AssetStateConflictException("업로드가 확인되지 않았습니다."));
        boolean isMaterial = asset.getKind() == AssetKind.MATERIAL;
        long maxSize = isMaterial ? MAX_MATERIAL_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
        if (head.contentLength() > maxSize) {
            throw new AssetValidationException("업로드 파일이 최대 크기를 초과했습니다.");
        }
        // MATERIAL은 신뢰 경계가 스토리지가 보고하는 content-type뿐이라(magic bytes 검증은 CP3
        // ingestion 파서에서) null을 통과시키지 않는다(fail closed) — 이미지는 헤더 부재가 흔해
        // 기존처럼 null 통과를 유지한다.
        if (isMaterial) {
            if (head.contentType() == null || !MATERIAL_CONTENT_TYPE.equals(head.contentType())) {
                throw new AssetValidationException("허용되지 않는 파일 형식입니다: " + head.contentType());
            }
        } else if (head.contentType() != null && !ALLOWED_IMAGE_TYPES.contains(head.contentType())) {
            throw new AssetValidationException("허용되지 않는 파일 형식입니다: " + head.contentType());
        }
        // 신고값이 아니라 실제 검증된 값으로 확정 저장.
        asset.setSizeBytes(head.contentLength());
        if (head.contentType() != null) {
            asset.setContentType(head.contentType());
        }
        asset.setStatus(AssetStatus.UPLOADED);
        log.info(Audit.MARKER, "에셋 업로드 완료 assetId={} requesterId={} size={}", assetId, requesterId, head.contentLength());
    }

    // ── AssetDirectory 포트 ──

    @Override
    @Transactional(readOnly = true)
    public Optional<AssetRef> find(UUID assetId) {
        return assetRepository.findById(assetId).map(this::toRef);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, AssetRef> findRefs(Collection<UUID> assetIds) {
        if (assetIds == null || assetIds.isEmpty()) {
            return Map.of();
        }
        List<UUID> distinct = assetIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        Map<UUID, AssetRef> refs = new HashMap<>();
        for (Asset asset : assetRepository.findAllById(distinct)) {
            refs.put(asset.getId(), toRef(asset));
        }
        return refs;
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, String> resolveUrls(Collection<UUID> assetIds) {
        if (assetIds == null || assetIds.isEmpty()) {
            return Map.of();
        }
        List<UUID> distinct = assetIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        Map<UUID, String> urls = new HashMap<>();
        for (Asset asset : assetRepository.findAllById(distinct)) {
            if (asset.getStatus() == AssetStatus.UPLOADED) {
                urls.put(asset.getId(), presignDownload(asset));
            }
        }
        return urls;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> resolveUrl(UUID assetId) {
        if (assetId == null) {
            return Optional.empty();
        }
        return assetRepository.findById(assetId)
                .filter(a -> a.getStatus() == AssetStatus.UPLOADED)
                .map(this::presignDownload);
    }

    private String presignDownload(Asset asset) {
        return storage.presignDownload(asset.getObjectKey(), Duration.ofSeconds(props.getDownloadTtlSeconds()));
    }

    private AssetRef toRef(Asset asset) {
        return new AssetRef(asset.getId(), asset.getKind().name(), asset.getStatus().name(),
                asset.getUploadedBy(), asset.getOriginalFilename(),
                asset.getSizeBytes() == null ? 0L : asset.getSizeBytes());
    }

    /**
     * kind별 형식·크기 검증. 이미지(THUMBNAIL·PROFILE_IMAGE)는 이미지 MIME·5MiB, 자료(MATERIAL)는
     * PPTX·50MiB로 분기한다(ADR-0034). 크기 상한이 kind마다 다르므로 여기서 kind를 봐야 한다.
     */
    private void validateUploadRequest(AssetKind kind, String contentType, long fileSize) {
        long maxSize;
        if (kind == AssetKind.MATERIAL) {
            if (contentType == null || !MATERIAL_CONTENT_TYPE.equals(contentType)) {
                throw new AssetValidationException("허용되지 않는 자료 형식입니다(PPTX만).");
            }
            maxSize = MAX_MATERIAL_SIZE_BYTES;
        } else {
            if (contentType == null || !ALLOWED_IMAGE_TYPES.contains(contentType)) {
                throw new AssetValidationException("허용되지 않는 이미지 형식입니다(jpeg·png·webp).");
            }
            maxSize = MAX_IMAGE_SIZE_BYTES;
        }
        if (fileSize <= 0) {
            throw new AssetValidationException("파일 크기가 올바르지 않습니다.");
        }
        if (fileSize > maxSize) {
            throw new AssetValidationException("파일 크기가 허용 한도를 초과합니다.");
        }
    }
}

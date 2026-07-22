package com.liveclass.curriculum.service;

/**
 * baseVersion 불일치 → 409 STRUCTURE_VERSION_CONFLICT. 프론트가 곧바로 재조회·재적용할 수 있도록
 * 최신 structureVersion을 함께 실어 보낸다(CURRICULUM_MANAGEMENT.md §7).
 */
public class StructureVersionConflictException extends RuntimeException {

    private final int latestVersion;

    public StructureVersionConflictException(String message, int latestVersion) {
        super(message);
        this.latestVersion = latestVersion;
    }

    public int getLatestVersion() {
        return latestVersion;
    }
}

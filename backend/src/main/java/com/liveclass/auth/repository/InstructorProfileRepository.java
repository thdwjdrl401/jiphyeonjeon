package com.liveclass.auth.repository;

import com.liveclass.auth.domain.InstructorProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface InstructorProfileRepository extends JpaRepository<InstructorProfile, UUID> {
}

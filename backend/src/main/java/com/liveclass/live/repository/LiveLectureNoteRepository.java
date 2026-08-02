package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveLectureNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LiveLectureNoteRepository extends JpaRepository<LiveLectureNote, UUID> {
}

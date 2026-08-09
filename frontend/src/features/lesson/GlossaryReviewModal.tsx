import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SOURCE_LABEL } from '@/features/live-session/glossaryView'
import {
  deleteGlossaryTerm,
  getGlossary,
  upsertGlossaryTerm,
  type GlossaryTerm,
} from '@/features/live-session/liveSessionService'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import { useToast } from '@/shared/ui/Toast'

interface GlossaryReviewModalProps {
  lessonId: string
  lessonTitle: string
  onClose: () => void
}

/**
 * 라이브 시작 전 핵심 용어 검수 모달. AI가 자료에서 뽑은 용어(MATERIAL)를 강사가 고치거나,
 * 빠진 용어를 더한다(INSTRUCTOR) — 둘 다 같은 upsert 엔드포인트다(ADR-songjeongki/0064).
 *
 * <p>숨김(삭제)은 아직 없다 — 지금 범위는 수정·추가까지다. AI 추출이 기본 꺼져 있어 목록이
 * 비어 있을 수 있고, 그때는 전부 강사가 직접 채우는 입력 폼이 된다.
 */
export default function GlossaryReviewModal({ lessonId, lessonTitle, onClose }: GlossaryReviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const toast = useToast()
  const queryClient = useQueryClient()
  const queryKey = ['glossary', lessonId]
  const glossaryQuery = useQuery({ queryKey, queryFn: () => getGlossary(lessonId), enabled: Boolean(lessonId) })
  const terms = glossaryQuery.data ?? []

  const [editingTermId, setEditingTermId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingTermId, setSavingTermId] = useState<string | null>(null)
  const [newTerm, setNewTerm] = useState('')
  const [newDefinition, setNewDefinition] = useState('')

  const upsertMutation = useMutation({
    mutationFn: (input: { term: string; definition: string }) => upsertGlossaryTerm(lessonId, input.term, input.definition),
    onSuccess: (saved) => {
      queryClient.setQueryData<GlossaryTerm[]>(queryKey, (previous = []) => {
        const index = previous.findIndex((entry) => entry.termId === saved.termId)
        return index >= 0
          ? previous.map((entry, entryIndex) => entryIndex === index ? saved : entry)
          : [...previous, saved]
      })
    },
    onError: () => toast.error('용어를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    onSettled: () => setSavingTermId(null),
  })

  /*
   * 용어를 목록에서 내린다.
   *
   * <p>AI가 자료에서 뽑은 용어여도 내려간다 — 서버가 원본을 지우는 것이 아니라 지웠다는 사실을
   * 덮어쓰기 자리에 남기기 때문이다(ADR-0110). 그래서 자료를 다시 읽어도 되돌아오지 않는다.
   *
   * <p>되돌리려면 같은 이름으로 다시 등록하면 된다. 그 길이 열려 있어서 확인 창을 두지 않는다 —
   * 지우는 것이 강의 자체를 건드리지도 않는다.
   */
  const deleteMutation = useMutation({
    mutationFn: (term: string) => deleteGlossaryTerm(lessonId, term),
    onSuccess: (_result, term) => {
      queryClient.setQueryData<GlossaryTerm[]>(queryKey, (previous = []) => (
        previous.filter((entry) => entry.termId !== term)
      ))
      toast.success('용어를 목록에서 내렸습니다. 같은 이름으로 다시 등록하면 되살아납니다.')
    },
    onError: () => toast.error('용어를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
  })

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  function startEdit(term: GlossaryTerm) {
    setEditingTermId(term.termId)
    setEditValue(term.definition)
  }

  function saveEdit(term: GlossaryTerm) {
    const trimmed = editValue.trim()
    if (!trimmed) return
    setSavingTermId(term.termId)
    upsertMutation.mutate({ term: term.term, definition: trimmed }, {
      onSuccess: () => setEditingTermId(null),
    })
  }

  const trimmedNewTerm = newTerm.trim()
  const trimmedNewDefinition = newDefinition.trim()
  const isDuplicateNewTerm = trimmedNewTerm.length > 0 && terms.some((term) => term.term === trimmedNewTerm)

  function addTerm(event: FormEvent) {
    event.preventDefault()
    if (!trimmedNewTerm || !trimmedNewDefinition || isDuplicateNewTerm) return
    setSavingTermId(trimmedNewTerm)
    upsertMutation.mutate({ term: trimmedNewTerm, definition: trimmedNewDefinition }, {
      onSuccess: () => {
        setNewTerm('')
        setNewDefinition('')
      },
    })
  }

  return (
    <div
      className="profile-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="profile-modal glossary-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-review-title"
        aria-describedby="glossary-review-description"
      >
        <header className="profile-modal__header">
          <div>
            <h2 id="glossary-review-title">핵심 용어 검수</h2>
            <p id="glossary-review-description">{lessonTitle} · 라이브 시작 전 AI가 뽑은 용어를 확인하고 빠진 용어를 더합니다.</p>
          </div>
          <button
            ref={closeButtonRef}
            className="profile-modal__close"
            type="button"
            aria-label="핵심 용어 검수 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {glossaryQuery.isPending && <p className="panel-empty">용어집을 불러오는 중입니다.</p>}
        {glossaryQuery.isError && <InlineNotice tone="danger">용어집을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</InlineNotice>}

        {!glossaryQuery.isPending && !glossaryQuery.isError && (
          <>
            {terms.length === 0
              ? <InlineNotice>아직 등록된 핵심 용어가 없습니다. 아래에서 직접 추가해 주세요.</InlineNotice>
              : (
                <ul className="glossary-review-list">
                  {terms.map((term) => (
                    <li className="glossary-review-row" key={term.termId}>
                      <div className="glossary-review-row__head">
                        <strong>{term.term}</strong>
                        <span className={`glossary-review-row__source glossary-review-row__source--${term.source.toLowerCase()}`}>
                          {SOURCE_LABEL[term.source]}
                        </span>
                      </div>
                      {editingTermId === term.termId ? (
                        <div className="glossary-review-row__edit">
                          <textarea
                            aria-label={`${term.term} 정의 수정`}
                            rows={3}
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                          />
                          <div className="glossary-review-row__edit-actions">
                            <button className="button button--ghost button--small" type="button" onClick={() => setEditingTermId(null)}>취소</button>
                            <button
                              className="button button--primary button--small"
                              type="button"
                              disabled={!editValue.trim() || savingTermId === term.termId}
                              onClick={() => saveEdit(term)}
                            >
                              {savingTermId === term.termId ? '저장 중' : '저장'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="glossary-review-row__view">
                          <p>{term.definition}</p>
                          <button className="text-button" type="button" onClick={() => startEdit(term)}>수정</button>
                          <button
                            className="text-button text-button--danger"
                            disabled={deleteMutation.isPending}
                            type="button"
                            onClick={() => deleteMutation.mutate(term.termId)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

            {/* 목록만 스크롤한다 — 이 폼은 팝업 하단에 고정된다(모달 크롬은 flex column, 이 폼은
                flex: 0 0 auto). */}
            <form className="glossary-review-form" onSubmit={addTerm}>
              <span className="glossary-review-form__label">용어 추가</span>
              <div className="glossary-review-form__row">
                <div className="glossary-review-form__fields">
                  <input
                    aria-label="추가할 용어"
                    placeholder="용어"
                    value={newTerm}
                    onChange={(event) => setNewTerm(event.target.value)}
                  />
                  <textarea
                    aria-label="추가할 용어의 정의"
                    placeholder="정의"
                    rows={2}
                    value={newDefinition}
                    onChange={(event) => setNewDefinition(event.target.value)}
                  />
                </div>
                <button
                  className="button button--soft button--small glossary-review-form__submit"
                  type="submit"
                  disabled={!trimmedNewTerm || !trimmedNewDefinition || isDuplicateNewTerm || savingTermId === trimmedNewTerm}
                >
                  {savingTermId === trimmedNewTerm && trimmedNewTerm ? '추가 중' : '추가'}
                </button>
              </div>
              {isDuplicateNewTerm && <small className="glossary-review-form__hint">이미 있는 용어입니다. 목록에서 수정해 주세요.</small>}
            </form>
          </>
        )}
      </section>
    </div>
  )
}

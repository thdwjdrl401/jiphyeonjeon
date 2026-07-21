import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { demoLesson, demoSession, getDemoLesson, getDemoLiveSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

export default function LiveSessionFormPage() {
  const { lessonId = demoLesson.lessonId, sessionId } = useParams()
  const isEdit = Boolean(sessionId)
  const session = sessionId ? getDemoLiveSession(sessionId) : null
  const lesson = getDemoLesson(session?.lessonId ?? lessonId)
  const navigate = useNavigate()
  const [scheduledAt, setScheduledAt] = useState('2026-08-01T10:00')
  const [duration, setDuration] = useState('90')
  const [entryWindow, setEntryWindow] = useState('10')
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  usePageTitle(isEdit ? '라이브 일정 수정' : '라이브 일정 만들기')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    navigate(instructorPaths.liveSession(session?.sessionId ?? lesson.liveSession?.sessionId ?? demoSession.sessionId))
  }
  return <div className="workspace-page workspace-page--narrow"><PageHeader eyebrow="LIVE SCHEDULE" title={isEdit ? '라이브 일정 수정' : '라이브 일정 만들기'} description={`${lesson.title}의 라이브 강의 일정을 설정합니다.`} />
    <form className="workspace-form" onSubmit={submit}><Panel title="일정과 입장 정책" description="예정 시각만으로 강의를 자동 시작하지 않으며 강사가 직접 시작합니다."><div className="form-grid"><label className="form-field--wide"><span>예정 시작 시각 *</span><input required type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label><label><span>예상 진행 시간</span><div className="input-with-unit"><input min="10" max="480" type="number" value={duration} onChange={(event) => setDuration(event.target.value)} /><span>분</span></div></label><label><span>입장 가능 창</span><div className="input-with-unit"><input min="0" max="60" type="number" value={entryWindow} onChange={(event) => setEntryWindow(event.target.value)} /><span>분 전</span></div></label></div><label className="choice-row"><input type="checkbox" checked={saveAsDraft} onChange={(event) => setSaveAsDraft(event.target.checked)} /><span><strong>일정 초안으로 저장</strong><small>확정 전에는 수강생에게 노출하지 않습니다.</small></span></label></Panel>
      <Panel title="항상 적용되는 운영 정책"><ul className="policy-list"><li><span>●</span><div><strong>녹화</strong><p>라이브 시작과 함께 Egress HLS 녹화가 시작됩니다.</p></div></li><li><span>CC</span><div><strong>실시간 자막</strong><p>발화가 자막과 AI 근거에 사용됩니다.</p></div></li><li><span>AI</span><div><strong>학습 보조</strong><p>채팅, 개인 질문과 강의 자료가 학습 기능에 연결됩니다.</p></div></li></ul><InlineNotice tone="warning">레슨이 게시되지 않았거나 AI 준비가 끝나지 않으면 일정 저장은 가능하지만 라이브 시작은 차단됩니다.</InlineNotice></Panel>
      <div className="sticky-form-actions"><Link className="button button--ghost" to={instructorPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)}>취소</Link><button className="button button--primary button--large" type="submit">{saveAsDraft ? '초안 저장' : '일정 저장'}</button></div></form></div>
}

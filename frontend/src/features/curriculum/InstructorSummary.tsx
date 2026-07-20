import type { CurriculumInstructorProfile } from './types'

interface InstructorSummaryProps {
  instructor: CurriculumInstructorProfile
}

export default function InstructorSummary({ instructor }: InstructorSummaryProps) {
  return (
    <section className="instructor-summary" aria-labelledby="instructor-summary-heading">
      <h2 id="instructor-summary-heading">담당 강사</h2>
      <strong>{instructor.displayName} 강사</strong>
      <p>{instructor.bio}</p>
      {instructor.expertise.length > 0 && (
        <ul className="instructor-summary__expertise">
          {instructor.expertise.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

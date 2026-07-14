interface ConferenceCardProps {
  title?: string
  description?: string
}

const DEFAULT_DESCRIPTION = "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s."

export function ConferenceCard({
  title = '제목',
  description = DEFAULT_DESCRIPTION,
}: ConferenceCardProps) {
  return (
    <article className="conference-card">
      <div className="conference-image" aria-hidden="true" />
      <div className="conference-card-content">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </article>
  )
}

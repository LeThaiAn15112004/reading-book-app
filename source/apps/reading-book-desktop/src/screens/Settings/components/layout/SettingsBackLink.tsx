import { Link } from 'react-router-dom'

export function SettingsBackLink() {
  return (
    <p className="m-0">
      <Link
        to="/library"
        className="text-sm font-medium text-lib-accent no-underline transition-colors hover:text-lib-accent-hover"
      >
        ← Back to Library
      </Link>
    </p>
  )
}

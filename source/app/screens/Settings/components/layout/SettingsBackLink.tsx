import { Link } from 'react-router-dom'
import { useT } from '../../../../i18n'

export function SettingsBackLink() {
  const t = useT()
  return (
    <p className="m-0">
      <Link
        to="/library"
        className="text-sm font-medium text-lib-accent no-underline transition-colors hover:text-lib-accent-hover"
      >
        {t('settings.backToLibrary')}
      </Link>
    </p>
  )
}

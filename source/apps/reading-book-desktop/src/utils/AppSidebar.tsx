import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** SDS SCR-01 nav ids (no global Notes). */
export type AppNavId =
  | 'library'
  | 'favorites'
  | 'completed'
  | 'to-read'
  | 'collections'
  | 'cloud-sources'
  | 'settings'
  | 'faq'
  | 'support'
  | 'about'
  | 'privacy'

export type AppSidebarProps = {
  activeId: AppNavId
  /** Called for stub destinations until real views are wired. */
  onStubNav?: (id: Exclude<AppNavId, 'library' | 'settings'>) => void
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  )
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  )
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
      />
    </svg>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  )
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  )
}

function CollectionIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122"
      />
    </svg>
  )
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z"
      />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.645-.869L9.594 3.94Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  )
}

function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
      />
    </svg>
  )
}

function SupportIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
      />
    </svg>
  )
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
      />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  )
}

type RoutedNavId = 'library' | 'settings'

type NavItem =
  | {
      id: RoutedNavId
      label: string
      to: string
      icon: ReactNode
    }
  | {
      id: Exclude<AppNavId, RoutedNavId>
      label: string
      icon: ReactNode
    }

const PRIMARY_ITEMS: readonly NavItem[] = [
  {
    id: 'library',
    label: 'Library',
    to: '/library',
    icon: <BookIcon className="size-5 shrink-0" />,
  },
  {
    id: 'favorites',
    label: 'Favorites',
    icon: <StarIcon className="size-5 shrink-0" />,
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: <CheckCircleIcon className="size-5 shrink-0" />,
  },
  {
    id: 'to-read',
    label: 'To read',
    icon: <BookmarkIcon className="size-5 shrink-0" />,
  },
  {
    id: 'collections',
    label: 'Collections',
    icon: <CollectionIcon className="size-5 shrink-0" />,
  },
]

const CLOUD_ITEMS: readonly NavItem[] = [
  {
    id: 'cloud-sources',
    label: 'Cloud Sources',
    icon: <CloudIcon className="size-5 shrink-0" />,
  },
]

/** Secondary line under Cloud Sources when sidebar is expanded. */
const CLOUD_SOURCES_SUBLABEL = 'Connected Drives'

const FOOTER_ITEMS: readonly NavItem[] = [
  {
    id: 'settings',
    label: 'Settings',
    to: '/settings',
    icon: <SettingsIcon className="size-5 shrink-0" />,
  },
  {
    id: 'faq',
    label: 'FAQ',
    icon: <QuestionIcon className="size-5 shrink-0" />,
  },
  {
    id: 'support',
    label: 'Support',
    icon: <SupportIcon className="size-5 shrink-0" />,
  },
  {
    id: 'about',
    label: 'About this app',
    icon: <InfoIcon className="size-5 shrink-0" />,
  },
  {
    id: 'privacy',
    label: 'Privacy policy',
    icon: <ShieldIcon className="size-5 shrink-0" />,
  },
]

function navClassName(active: boolean, collapsed: boolean): string {
  const base =
    'relative flex w-full items-center gap-3 rounded-lg border-none bg-transparent text-left text-sm font-medium text-lib-muted no-underline transition-colors hover:bg-white/5 hover:text-lib-text-strong'
  const pad = collapsed ? 'justify-center p-3' : 'px-4 py-3'
  if (!active) return `${base} ${pad}`
  const activeCls = 'bg-white/[0.06] text-lib-text-strong'
  const bar =
    collapsed
      ? ''
      : ' before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r before:bg-lib-accent before:content-[""]'
  return `${base} ${pad} ${activeCls}${bar}`
}

function NavDivider({ collapsed }: { collapsed: boolean }) {
  return (
    <li
      className={`list-none py-2 ${collapsed ? 'px-2' : 'px-3'}`}
      aria-hidden
    >
      <div className="h-px w-full bg-lib-border-soft" />
    </li>
  )
}

function renderNavItem(
  item: NavItem,
  activeId: AppNavId,
  collapsed: boolean,
  onStubNav?: AppSidebarProps['onStubNav'],
  sublabel?: string,
) {
  const active = item.id === activeId
  const className = navClassName(active, collapsed)
  const label = (
    <span
      className={`min-w-0 truncate transition-opacity ${
        collapsed ? 'w-0 overflow-hidden opacity-0' : 'opacity-100'
      }`}
    >
      {sublabel ? (
        <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
          <span className="truncate">{item.label}</span>
          <span className="truncate text-[11px] font-normal text-lib-faint">
            {sublabel}
          </span>
        </span>
      ) : (
        item.label
      )}
    </span>
  )

  const title = collapsed
    ? sublabel
      ? `${item.label} — ${sublabel}`
      : item.label
    : undefined

  if ('to' in item) {
    return (
      <li key={item.id}>
        <Link
          to={item.to}
          className={className}
          aria-current={active ? 'page' : undefined}
          title={title}
        >
          {item.icon}
          {label}
        </Link>
      </li>
    )
  }

  return (
    <li key={item.id}>
      <button
        type="button"
        className={className}
        title={title ?? (collapsed ? item.label : undefined)}
        onClick={() => onStubNav?.(item.id)}
      >
        {item.icon}
        {label}
      </button>
    </li>
  )
}

/**
 * Shared app chrome sidebar (SCR-01). Lives in utils so Library / Settings / etc. can reuse it.
 * Colors match docs/mockups/library.html (slate + amber).
 */
export function AppSidebar({ activeId, onStubNav }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-lib-border bg-lib-surface-strong backdrop-blur-[14px] transition-[width] duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
        collapsed ? 'w-[72px]' : 'w-[248px]'
      }`}
      aria-label="Main navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div
        className={`flex h-16 items-center gap-2 border-b border-lib-border-soft ${
          collapsed ? 'justify-center px-0' : 'justify-between px-[18px]'
        }`}
      >
        <div
          className={`flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap transition-opacity ${
            collapsed ? 'pointer-events-none w-0 opacity-0' : 'opacity-100'
          }`}
        >
          <BookIcon className="size-[22px] shrink-0 text-lib-accent drop-shadow-[0_0_8px_rgba(245,158,11,0.35)]" />
          <span className="text-[15px] font-bold tracking-[0.22em] text-lib-text-strong uppercase">
            Readmate
          </span>
        </div>
        <button
          type="button"
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-faint transition-colors hover:bg-white/5 hover:text-lib-accent"
          title="Collapse / expand menu"
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <MenuIcon className="size-5" />
        </button>
      </div>

      <nav className="lib-sidebar-scroll mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-5">
        <ul className="flex list-none flex-col gap-2">
          {PRIMARY_ITEMS.map((item) =>
            renderNavItem(item, activeId, collapsed, onStubNav),
          )}
          <NavDivider collapsed={collapsed} />
          {CLOUD_ITEMS.map((item) =>
            renderNavItem(
              item,
              activeId,
              collapsed,
              onStubNav,
              item.id === 'cloud-sources' ? CLOUD_SOURCES_SUBLABEL : undefined,
            ),
          )}
        </ul>

        <ul className="mt-auto flex list-none flex-col gap-2 pt-4">
          <NavDivider collapsed={collapsed} />
          {FOOTER_ITEMS.map((item) =>
            renderNavItem(item, activeId, collapsed, onStubNav),
          )}
        </ul>
      </nav>
    </aside>
  )
}

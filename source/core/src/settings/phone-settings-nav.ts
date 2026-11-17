/**
 * Phone Settings ("More") navigation rules (spec 014). The phone shows the section list at `/settings` and one section
 * per page at `/settings/:section`; only sections visible on the host can be opened.
 */

/** The section id named by the route parameter, or null when it is missing, unknown or hidden on this host. */
export function sectionFromParam<T extends string>(param: string | undefined, visible: readonly T[]): T | null {
  if (!param) return null
  return (visible as readonly string[]).includes(param) ? (param as T) : null
}

import { EN_CATALOGUE, type AreaId } from './catalogue/en/index.js'
import { VI_CATALOGUE } from './catalogue/vi/index.js'
import { isPendingArea } from './pending.js'
import type { UiLanguage } from './types.js'

export { EN_CATALOGUE, VI_CATALOGUE }
export type { AreaId, EnCatalogue } from './catalogue/en/index.js'

/** Untyped view of both catalogues, used by the lookup and the tests. */
export type CatalogueSet = Readonly<Record<UiLanguage, Readonly<Record<string, unknown>>>>

export const CATALOGUES: CatalogueSet = { en: EN_CATALOGUE, vi: VI_CATALOGUE }

export const AREA_IDS = Object.keys(EN_CATALOGUE) as AreaId[]

/** Vietnamese areas still marked `pendingArea(…)` — derived, so converting an area only touches its own files. */
export const PENDING_VI_AREAS: readonly { readonly area: AreaId; readonly reason: string }[] = AREA_IDS.flatMap(
  (area) => {
    const value: unknown = VI_CATALOGUE[area]
    return isPendingArea(value) ? [{ area, reason: value.reason }] : []
  },
)

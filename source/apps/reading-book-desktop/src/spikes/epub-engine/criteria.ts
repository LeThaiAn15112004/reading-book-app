/** T3.1 spike criteria — must stay aligned with plan / MATRIX.md */

export type Verdict = 'Pass' | 'Partial' | 'Fail' | 'Pending'

export type CriterionId =
  | 'open_arraybuffer'
  | 'toc'
  | 'nav_scroll'
  | 'cfi'
  | 'theme_css'
  | 'selection'
  | 'search'
  | 'electron_vite'
  | 'maintenance'

export interface CriterionDef {
  id: CriterionId
  label: string
  required: boolean
}

export const CRITERIA: CriterionDef[] = [
  { id: 'open_arraybuffer', label: 'Open from ArrayBuffer / Blob', required: true },
  { id: 'toc', label: 'TOC (spine / nav)', required: true },
  { id: 'nav_scroll', label: 'Next/prev + scroll mode', required: true },
  { id: 'cfi', label: 'CFI / stable location get·set', required: true },
  { id: 'theme_css', label: 'Runtime theme/font CSS (no file mutate)', required: true },
  { id: 'selection', label: 'Text selection in reading surface', required: true },
  { id: 'search', label: 'Search-in-book feasible', required: false },
  { id: 'electron_vite', label: 'Electron/Vite / license / CSP', required: false },
  { id: 'maintenance', label: 'Maintenance cost', required: false },
]

export interface CriterionResult {
  id: CriterionId
  verdict: Verdict
  note: string
}

export type EngineId = 'epubjs' | 'foliate' | 'baseline'

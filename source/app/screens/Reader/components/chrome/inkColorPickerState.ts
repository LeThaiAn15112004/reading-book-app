/**
 * True while the system colour dialog is open. Opening it blurs the window, which would close the settings popover
 * (and unmount the picker) before its `change` fires — so the popovers ignore that blur meanwhile.
 */
let open = false

/**
 * What the system colour picker's events do. It fires `input` while a colour is being chosen and `change` when its
 * dialog closes. `live` = the control edits the settings of the NEXT drawing (Freehand / Shape): every `input` is applied
 * to the settings at once, so what the dialog shows IS the colour the next stroke gets — a colour that was only
 * previewed (never committed) must never be displayed as if it were chosen. A control that edits an existing object
 * (selected stroke) previews on `input` and commits once on `change`, so one pick is one undo step.
 */
export function pickerEventAction(event: 'input' | 'change', live: boolean): { commit: boolean; preview: boolean } {
  if (live) return { commit: true, preview: false }
  return event === 'change' ? { commit: true, preview: false } : { commit: false, preview: true }
}

export function isInkColorPickerOpen(): boolean {
  return open
}

export function setInkColorPickerOpen(value: boolean): void {
  open = value
}

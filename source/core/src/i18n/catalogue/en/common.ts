/** English texts shared by every area (spec 012): generic actions and unit words. */
export const en = {
  actions: {
    ok: 'OK',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    delete: 'Delete',
    remove: 'Remove',
    retry: 'Retry',
    open: 'Open',
    undo: 'Undo',
    redo: 'Redo',
  },
  duration: {
    hours: { one: '{count} h', other: '{count} h' },
    minutes: { one: '{count} min', other: '{count} min' },
    seconds: { one: '{count} s', other: '{count} s' },
  },
  units: {
    bytes: '{value} B',
    kilobytes: '{value} KB',
    megabytes: '{value} MB',
    gigabytes: '{value} GB',
  },
  appLanguage: {
    system: 'System Default',
  },
} as const

import { memo } from 'react'
import type { PdfAttachmentPin } from './attachmentPins'

type Props = {
  pins: readonly PdfAttachmentPin[]
  selectedId?: string | null
  /** The icon being dragged and where it would land (drawn there instead of at its box). */
  drag?: { id: string; box: PdfAttachmentPin['box'] } | null
}

/** The page's attachment icons. Pointer input is handled by the renderer's surface (hit-tested with `attachmentPinAt`). */
export const PdfPageAttachments = memo(function PdfPageAttachments({ pins, selectedId = null, drag = null }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 4 }} data-pdf-attachments="">
      {pins.map((pin) => {
        const selected = pin.id === selectedId
        const box = drag?.id === pin.id ? drag.box : pin.box
        return (
          <div
            key={pin.id}
            role="img"
            aria-label={`Attached file: ${pin.name}`}
            title={pin.name}
            data-attachment-id={pin.id}
            data-attachment-pending={pin.pending ? '' : undefined}
            className="pointer-events-auto absolute flex items-center justify-center rounded-[3px]"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
              opacity: pin.pending || drag?.id === pin.id ? 0.55 : 1,
              cursor: pin.editable ? 'move' : 'pointer',
              background: '#FFF7D1',
              border: `1.5px solid ${selected ? '#0D47A1' : '#1E88E5'}`,
              boxShadow: selected ? '0 0 0 2px rgba(30, 136, 229, 0.45)' : '0 1px 2px rgba(0, 0, 0, 0.25)',
              color: '#333',
            }}
          >
            <svg viewBox="0 0 24 24" width="75%" height="75%" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m18.4 11.6-6.8 6.8a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.2l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l6.8-6.8" />
            </svg>
          </div>
        )
      })}
    </div>
  )
})

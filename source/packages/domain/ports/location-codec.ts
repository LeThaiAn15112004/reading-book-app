import type { Location } from '../models/location.js';

/**
 * Engine-specific selection / caret payload used when creating a Location.
 * Adapters map this to CFI, page-rect, or text-offset.
 */
export type LocationEncodeInput = unknown;

/**
 * Opaque engine handle for jumping / selecting from a stored Location.
 */
export type LocationDecodeResult = unknown;

/**
 * Encode / decode stable in-document positions (SDS §2.6).
 * Adapters: CfiCodec, PageRectCodec, TextOffsetCodec.
 */
export interface LocationCodec {
  encode(input: LocationEncodeInput): Location;
  decode(location: Location): LocationDecodeResult;
}

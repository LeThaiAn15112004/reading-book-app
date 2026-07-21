/** Axis-aligned rectangle for PDF page overlay (SDS §3.5). */
export class Rect {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly width: number,
    public readonly height: number,
  ) {}

  equals(other: Rect): boolean {
    return (
      this.x === other.x &&
      this.y === other.y &&
      this.width === other.width &&
      this.height === other.height
    );
  }
}

/**
 * Stable in-document position (value object).
 * Persist via toString(); revive with Location.parse (SDS class diagram).
 */
export abstract class Location {
  abstract readonly kind: 'cfi' | 'page-rect' | 'text-offset';

  abstract toString(): string;

  abstract equals(other: Location): boolean;

  static parse(raw: string): Location {
    const data = JSON.parse(raw) as { kind?: string };
    switch (data.kind) {
      case 'cfi':
        return CfiLocation.fromPlain(data as CfiLocationPlain);
      case 'page-rect':
        return PageRectLocation.fromPlain(data as PageRectLocationPlain);
      case 'text-offset':
        return TextOffsetLocation.fromPlain(data as TextOffsetLocationPlain);
      default:
        throw new Error(`Unknown location kind in: ${raw}`);
    }
  }
}

export interface CfiLocationPlain {
  kind: 'cfi';
  cfi: string;
}

export class CfiLocation extends Location {
  readonly kind = 'cfi' as const;

  constructor(public readonly cfi: string) {
    super();
    if (!cfi.trim()) {
      throw new Error('CFI must not be empty');
    }
  }

  toString(): string {
    return JSON.stringify({ kind: this.kind, cfi: this.cfi } satisfies CfiLocationPlain);
  }

  equals(other: Location): boolean {
    return other instanceof CfiLocation && other.cfi === this.cfi;
  }

  static fromPlain(data: CfiLocationPlain): CfiLocation {
    return new CfiLocation(data.cfi);
  }
}

export interface PageRectLocationPlain {
  kind: 'page-rect';
  page: number;
  rect?: { x: number; y: number; width: number; height: number };
}

export class PageRectLocation extends Location {
  readonly kind = 'page-rect' as const;
  readonly rect?: Rect;

  constructor(public readonly page: number, rect?: Rect) {
    super();
    if (!Number.isFinite(page) || page < 1) {
      throw new Error('PDF page must be a finite number >= 1');
    }
    this.rect = rect;
  }

  toString(): string {
    const plain: PageRectLocationPlain = { kind: this.kind, page: this.page };
    if (this.rect) {
      plain.rect = {
        x: this.rect.x,
        y: this.rect.y,
        width: this.rect.width,
        height: this.rect.height,
      };
    }
    return JSON.stringify(plain);
  }

  equals(other: Location): boolean {
    if (!(other instanceof PageRectLocation) || other.page !== this.page) {
      return false;
    }
    if (this.rect && other.rect) {
      return this.rect.equals(other.rect);
    }
    return this.rect === other.rect;
  }

  static fromPlain(data: PageRectLocationPlain): PageRectLocation {
    const rect = data.rect
      ? new Rect(data.rect.x, data.rect.y, data.rect.width, data.rect.height)
      : undefined;
    return new PageRectLocation(data.page, rect);
  }
}

export interface TextOffsetLocationPlain {
  kind: 'text-offset';
  offset: number;
  blockId?: string;
}

export class TextOffsetLocation extends Location {
  readonly kind = 'text-offset' as const;

  constructor(
    public readonly offset: number,
    public readonly blockId?: string,
  ) {
    super();
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error('Text offset must be a finite number >= 0');
    }
  }

  toString(): string {
    const plain: TextOffsetLocationPlain = { kind: this.kind, offset: this.offset };
    if (this.blockId !== undefined) {
      plain.blockId = this.blockId;
    }
    return JSON.stringify(plain);
  }

  equals(other: Location): boolean {
    return (
      other instanceof TextOffsetLocation &&
      other.offset === this.offset &&
      other.blockId === this.blockId
    );
  }

  static fromPlain(data: TextOffsetLocationPlain): TextOffsetLocation {
    return new TextOffsetLocation(data.offset, data.blockId);
  }
}

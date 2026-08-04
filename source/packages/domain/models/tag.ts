export interface TagProps {
  id: string;
  name: string;
  colorHex?: string;
}

/** User-defined tag for highlights (SDS §3 — TAG). */
export class Tag {
  readonly id: string;
  name: string;
  colorHex?: string;

  constructor(props: TagProps) {
    if (!props.id.trim()) throw new Error('Tag.id is required');
    if (!props.name.trim()) throw new Error('Tag.name is required');

    this.id = props.id;
    this.name = props.name.trim();
    this.colorHex = props.colorHex?.trim() || undefined;
  }
}

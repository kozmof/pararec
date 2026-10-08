/** Map document line numbers to vertical positions, independent of text measurement. */
export interface VerticalLayout {
  readonly totalHeight: number;
  top(line: number): number;
  height(line: number): number;
  lineAt(y: number): number;
}

/** The imported editor's fixed-height layout, including one line for empty documents. */
export class FixedLayout implements VerticalLayout {
  readonly lineCount: number;

  constructor(
    lineCount: number,
    readonly lineHeight = 20,
  ) {
    this.lineCount = Math.max(1, lineCount);
  }

  get totalHeight(): number {
    return this.lineCount * this.lineHeight;
  }

  top(line: number): number {
    return line * this.lineHeight;
  }

  height(_line: number): number {
    return this.lineHeight;
  }

  lineAt(y: number): number {
    return Math.min(this.lineCount - 1, Math.max(0, Math.floor(y / this.lineHeight)));
  }
}

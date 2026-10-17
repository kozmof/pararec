import type { TextLink } from "../../schema.js";

type MenuPosition = { sourceId: string; x: number; y: number };
type LinkMenu = MenuPosition & Pick<TextLink, "start" | "end"> & { labelIds?: readonly string[] };
type LinkSelection = Pick<TextLink, "sourceId" | "start" | "end"> & { targets: string[] };

/** Own menu and link-selection state independently of document mutations. */
export class CellMenus {
  render = $state<MenuPosition | null>(null);
  link = $state<LinkMenu | null>(null);
  linking = $state<LinkSelection | null>(null);
  element = $state<HTMLDivElement>();
  constructor(
    private host: {
      blur(id: string): void;
      focused(): string | null;
      restoreFocus(id: string): Promise<void>;
    },
  ) {}
  close() {
    this.link = null;
    this.render = null;
  }
  reset() {
    this.linking = null;
    this.close();
  }
  openRender(sourceId: string, event: MouseEvent) {
    const focused = this.host.focused();
    if (focused && focused !== sourceId) this.host.blur(focused);
    this.close();
    this.render = {
      sourceId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 280)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
    };
  }
  startLink() {
    if (!this.link) return;
    const { sourceId, start, end } = this.link;
    this.linking = { sourceId, start, end, targets: [] };
    this.close();
    const focused = this.host.focused();
    if (focused) this.host.blur(focused);
  }
  selectCell(id: string) {
    const selection = this.linking;
    if (!selection || id === selection.sourceId) return;
    this.linking = {
      ...selection,
      targets: selection.targets.includes(id)
        ? selection.targets.filter((target) => target !== id)
        : [...selection.targets, id],
    };
  }
  cancel() {
    const source = (this.linking ?? this.link ?? this.render)?.sourceId;
    this.reset();
    if (source) void this.host.restoreFocus(source);
  }
  keydown = (event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
    if (event.key === "Tab") {
      const source = (this.render ?? this.link)?.sourceId;
      if (source) this.host.blur(source);
      this.close();
      return;
    }
    event.preventDefault();
    const buttons = [
      ...(this.element?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  blur = (event: FocusEvent) => {
    const menu = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && menu.contains(event.relatedTarget)) return;
    const source = menu.dataset.menuSourceId;
    if (
      event.relatedTarget instanceof Element &&
      event.relatedTarget.closest<HTMLElement>("[data-content-id]")?.dataset.contentId === source
    )
      return;
    if (source) this.host.blur(source);
    this.close();
  };
  dismissOutside = (event: MouseEvent) => {
    if (
      !(this.link || this.render) ||
      !(event.target instanceof Node) ||
      this.element?.contains(event.target)
    )
      return;
    const source = (this.render ?? this.link)?.sourceId;
    const cell =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-content-id]")
        : null;
    if (source && cell?.dataset.contentId !== source) this.host.blur(source);
    this.close();
  };
}

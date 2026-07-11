import type { FromEngine } from "../tex-compile/protocol";

export type NeededFont = Extract<FromEngine, { t: "fontsNeeded" }>["fonts"][number];

export interface FontResourceCache {
  get(hash: string): Promise<ArrayBuffer | null>;
}

export interface LoadableFontFace {
  load(): Promise<LoadableFontFace>;
}

export interface BrowserFontSet {
  add(font: LoadableFontFace): void;
}

export type FontFaceFactory = (
  family: string,
  source: ArrayBuffer,
  descriptors: FontFaceDescriptors,
) => LoadableFontFace;

const safeHash = (hash: string) => hash.toLowerCase().replace(/[^a-z0-9]/g, "");

export const fontFamilyForHash = (hash: string) => `f-${safeHash(hash).slice(0, 16)}`;
export const pendingFontClass = (hash: string) => `fonts-pending-${safeHash(hash).slice(0, 32)}`;

export class FontManager {
  readonly #cache: FontResourceCache;
  readonly #fontSet: BrowserFontSet;
  readonly #root: HTMLElement;
  readonly #factory: FontFaceFactory;
  readonly #loads = new Map<string, Promise<string>>();
  readonly #pendingRules = new Set<string>();

  constructor(
    cache: FontResourceCache,
    options: {
      fontSet?: BrowserFontSet;
      root?: HTMLElement;
      factory?: FontFaceFactory;
    } = {},
  ) {
    this.#cache = cache;
    this.#fontSet = options.fontSet ?? (document.fonts as unknown as BrowserFontSet);
    this.#root = options.root ?? document.documentElement;
    this.#factory =
      options.factory ??
      ((family, source, descriptors) =>
        new FontFace(family, source, descriptors) as unknown as LoadableFontFace);
  }

  ensure(font: NeededFont): Promise<string> {
    const current = this.#loads.get(font.fileHash);
    if (current) return current;

    const pendingClass = pendingFontClass(font.fileHash);
    this.#installPendingRule(font.fileHash);
    this.#root.classList.add(pendingClass);
    const load = this.#load(font).finally(() => this.#root.classList.remove(pendingClass));
    this.#loads.set(font.fileHash, load);
    return load;
  }

  ensureAll(fonts: readonly NeededFont[]): Promise<string[]> {
    return Promise.all(fonts.map((font) => this.ensure(font)));
  }

  async #load(font: NeededFont): Promise<string> {
    const bytes = await this.#cache.get(font.fileHash);
    if (!bytes) throw new Error(`Font resource not found: ${font.fileHash}`);
    const family = fontFamilyForHash(font.fileHash);
    const face = this.#factory(family, bytes, { style: font.styleKey ?? "normal" });
    const loaded = await face.load();
    this.#fontSet.add(loaded);
    return family;
  }

  #installPendingRule(hash: string): void {
    if (this.#pendingRules.has(hash)) return;
    this.#pendingRules.add(hash);
    const pendingClass = pendingFontClass(hash);
    const family = fontFamilyForHash(hash);
    const style = document.createElement("style");
    style.dataset.umberFontPending = hash;
    style.textContent = `html.${pendingClass} .${family}, html.${pendingClass} [style*="${family}"] { visibility: hidden !important; }`;
    document.head.append(style);
  }
}

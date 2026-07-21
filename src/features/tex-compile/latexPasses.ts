import type { CompileOutput } from "@umber/umber-wasm/low-level";

export const MAX_LATEX_PASSES = 4;
const INITIAL_GENERATED_EXTENSIONS = ["aux", "toc", "out", "lof", "lot"] as const;
const pageSizeSetup = new TextEncoder().encode(
  "\\relax\\special{papersize=\\the\\paperwidth,\\the\\paperheight}\n",
);

export function latexJobName(entry: string): string {
  const fileName = entry.replaceAll("\\", "/").split("/").at(-1) ?? "main.tex";
  return fileName.replace(/\.[^.]*$/, "") || "main";
}

export function initialLatexGeneratedFiles(entry: string): Map<string, Uint8Array> {
  const jobName = latexJobName(entry);
  return new Map(
    INITIAL_GENERATED_EXTENSIONS.map((extension) => [`${jobName}.${extension}`, new Uint8Array()]),
  );
}

export function prepareLatexGeneratedInput(
  entry: string,
  path: string,
  bytes: Uint8Array,
): Uint8Array {
  if (path !== `${latexJobName(entry)}.aux`) return bytes;
  const seeded = new Uint8Array(pageSizeSetup.byteLength + bytes.byteLength);
  seeded.set(pageSizeSetup);
  seeded.set(bytes, pageSizeSetup.byteLength);
  return seeded;
}

export function collectGeneratedFiles(output: CompileOutput): Map<string, Uint8Array> {
  return new Map(
    output.files.map((file) => [file.path.replace(/^\/job\//, ""), file.bytes.slice()] as const),
  );
}

export function generatedFileMapsEqual(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [path, leftBytes] of left) {
    const rightBytes = right.get(path);
    if (!rightBytes || leftBytes.byteLength !== rightBytes.byteLength) return false;
    if (leftBytes.some((byte, index) => byte !== rightBytes[index])) return false;
  }
  return true;
}

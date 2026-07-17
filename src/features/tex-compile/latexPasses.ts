import type { CompileOutput } from "@umber/umber-wasm/low-level";

export const MAX_LATEX_PASSES = 4;

export function latexJobName(entry: string): string {
  const fileName = entry.replaceAll("\\", "/").split("/").at(-1) ?? "main.tex";
  return fileName.replace(/\.[^.]*$/, "") || "main";
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

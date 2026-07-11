const addExtension = (name: string, extension: string) =>
  name.includes(".") ? name : `${name}.${extension}`;

export function scanTexDependencies(source: string): string[] {
  const dependencies = new Set<string>();
  for (const match of source.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    if (match[1]) dependencies.add(addExtension(match[1].trim(), "cls"));
  }
  for (const match of source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    for (const name of match[1]?.split(",") ?? [])
      dependencies.add(addExtension(name.trim(), "sty"));
  }
  for (const match of source.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
    if (match[1]) dependencies.add(addExtension(match[1].trim(), "tex"));
  }
  for (const match of source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    if (match[1]) dependencies.add(match[1].trim());
  }
  return [...dependencies].filter(Boolean);
}

import type { ResourceRequest, ResourceResponse } from "@umber/umber-wasm/low-level";

type FileRequest = Extract<ResourceRequest, { type: "file" }>;
type FontRequest = Extract<ResourceRequest, { type: "font" }>;

export type TfmResource = {
  name: string;
  virtualPath: string;
  bytes: Uint8Array;
};

export type Woff2OpenTypeFont = {
  logicalName: string;
  woff2: Uint8Array;
  objectSha256?: string;
  programIdentity?: string;
  provenance?: string;
};

export type FontResolutionBatch = {
  responses: ResourceResponse[];
  missing: ResourceRequest[];
};

/** Resolves classic TeX metric requests without knowing about font programs. */
export class TfmResourceResolver {
  readonly #resources: ReadonlyMap<string, TfmResource>;

  constructor(resources: Iterable<TfmResource>) {
    this.#resources = uniqueResources(resources, (resource) => resource.name, "TFM");
  }

  resolve(request: FileRequest): ResourceResponse | undefined {
    if (request.kind !== "tfm") return undefined;
    const resource = this.#resources.get(request.name);
    if (!resource) return undefined;
    return fileResponse(request, resource);
  }
}

/** Resolves OpenType requests exclusively from WOFF2 containers. */
export class Woff2OpenTypeResolver {
  readonly #fonts: ReadonlyMap<string, Woff2OpenTypeFont>;

  constructor(fonts: Iterable<Woff2OpenTypeFont>) {
    this.#fonts = uniqueResources(fonts, (font) => font.logicalName, "OpenType font");
    for (const font of this.#fonts.values()) assertWoff2(font);
  }

  resolve(request: FontRequest): ResourceResponse | undefined {
    if (!request.acceptedContainers.includes("woff2")) {
      throw new Error(`OpenType font ${request.logicalName} does not accept WOFF2`);
    }
    const font = this.#fonts.get(request.logicalName);
    if (!font) return undefined;
    return fontResponse(request, font);
  }
}

/** Routes the engine's two font models without coupling their resolvers. */
export class FontResourceRouter {
  constructor(
    readonly tfm: TfmResourceResolver,
    readonly openType: Woff2OpenTypeResolver,
  ) {}

  resolve(requests: readonly ResourceRequest[]): FontResolutionBatch {
    const responses: ResourceResponse[] = [];
    const missing: ResourceRequest[] = [];
    for (const request of requests) {
      const response =
        request.type === "font" ? this.openType.resolve(request) : this.tfm.resolve(request);
      if (response) responses.push(response);
      else missing.push(request);
    }
    return { responses, missing };
  }
}

function fileResponse(request: FileRequest, resource: TfmResource): ResourceResponse {
  return {
    type: "file",
    domain: request.domain,
    kind: request.kind,
    name: request.name,
    virtualPath: resource.virtualPath,
    bytes: resource.bytes,
  };
}

function fontResponse(request: FontRequest, font: Woff2OpenTypeFont): ResourceResponse {
  return {
    type: "font",
    logicalName: request.logicalName,
    faceIndex: request.faceIndex,
    variations: request.variations,
    features: request.features,
    container: "woff2",
    bytes: font.woff2,
    objectSha256: font.objectSha256,
    programIdentity: font.programIdentity,
    provenance: font.provenance,
  };
}

function assertWoff2(font: Woff2OpenTypeFont): void {
  const bytes = font.woff2;
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x77 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x32
  ) {
    throw new Error(`OpenType font ${font.logicalName} is not a WOFF2 container`);
  }
}

function uniqueResources<T>(
  resources: Iterable<T>,
  key: (resource: T) => string,
  label: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const resource of resources) {
    const name = key(resource);
    if (result.has(name)) throw new Error(`Duplicate ${label} resource: ${name}`);
    result.set(name, resource);
  }
  return result;
}

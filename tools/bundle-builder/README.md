# Umber bundle builder

Builds the immutable flat-name TeX resource bundle consumed by the browser resolver.

```sh
cargo run --release -- \
  /path/to/texlive-snapshot.tar.xz \
  /path/to/output \
  policy.json
```

Output:

- `files/<sha256>` for each unique resource payload;
- `manifest-<sha256>.json`, mapping flat TeX names to hashes, sizes, and optional flags.

The input may be a TeX Live snapshot tarball supported by the system `tar` command or an extracted
directory. Tar paths are checked for traversal before extraction, and a single wrapper-directory
chain is removed deterministically. The policy selects path prefixes, excludes unwanted trees, and
resolves every duplicate flat file name explicitly. Unresolved conflicts fail the build instead of
depending on filesystem order. Font normalization can happen before bundling when the engine needs
paired artifacts; original font files remain available and are flagged in the manifest.

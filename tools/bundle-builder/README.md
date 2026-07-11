# Umber bundle builder

Builds the immutable flat-name TeX resource bundle consumed by the browser resolver.

```sh
cargo run --release -- \
  /path/to/selected-texmf \
  /path/to/output \
  policy.json
```

Output:

- `files/<sha256>` for each unique resource payload;
- `manifest-<sha256>.json`, mapping flat TeX names to hashes, sizes, and optional flags.

Input selection, TeX Live extraction, and font normalization happen before this tool. The policy
selects path prefixes, excludes unwanted trees, and resolves every duplicate flat file name
explicitly. Unresolved conflicts fail the build instead of depending on filesystem order.

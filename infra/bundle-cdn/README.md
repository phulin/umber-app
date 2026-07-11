# Bundle CDN policy

Upload the output of `tools/bundle-builder` without transforming object bytes.

Required response policy:

| Path | Content type | Cache control |
|---|---|---|
| `/f/<sha256>` | `application/octet-stream` | `public, max-age=31536000, immutable` |
| `/manifest-<digest>.json` | `application/json` | `public, max-age=31536000, immutable` |

Apply `cors.json` to the public R2/S3 bucket. Requests never use credentials. Do not enable
on-the-fly content encoding for `/f/*`; the browser verifies the bytes against the object hash.

The browser resolver currently requests resource objects through `/f/<hash>`. If the object store
uses a `files/<hash>` key, configure a CDN rewrite from `/f/*` to `/files/*` without changing the
response body.

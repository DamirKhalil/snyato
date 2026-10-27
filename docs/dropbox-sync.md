# Dropbox metadata sync

The service route is `/api/dropbox-sync`. The hosted private-site access boundary remains enabled. A service caller also supplies its current Sites service bearer in the standard Authorization header; the route compares its SHA-256 with the configured runtime hash. Browser identity is never impersonated.

Runtime configuration uses `STUDIO_DROPBOX_FOLDER_JSON` for the selected folder metadata and `STUDIO_SYNC_TOKEN_SHA256` for the service-token digest. Configure these values through hosting secrets. Never commit actual credentials.

GET returns folder configuration, selected course, last successful sync time, file counts and revision. POST accepts a complete snapshot: `{ complete: true, files: [{ id, name, path, size, modifiedAt, mime?, url? }] }`. Enumerate all pages before posting. Snapshots are bounded to 5,000 files and 3 MiB JSON. Files must belong to the selected folder. Existing stable Dropbox links may be included; no links are created by this route.

Files are upserted by their native IDs. Metadata is stored without copying video. Lesson codes and material kinds are inferred from names. Missing links point to the selected folder and are explicitly marked indirect. Missing files are never deleted. A replaced selected video invalidates checked timecodes. Concurrent updates retry through three compare-and-swap attempts.

An explicit course binding takes priority. Otherwise a unique real-course title match is used. An empty studio can initialize a 25-lesson course; an unmatched existing studio requires an explicit binding. Initial owner creation still requires an authenticated studio visit.

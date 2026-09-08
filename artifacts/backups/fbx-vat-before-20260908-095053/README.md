# FBX/VAT Compression Rollback

This directory is the rollback point for the lossless FBX/VAT compression pass on 2026-09-08.

- `manifest.json` records every original file, byte count, and SHA-256.
- `compression-results.json` records the gzip output and verifies every decompressed file against the original hash.
- `public/` mirrors the original project paths before compression.

To restore the original resources from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File artifacts/backups/fbx-vat-before-20260908-095053/restore.ps1
```

The runtime loader changes in `src/scene-view.js` can remain in place during rollback because they accept both raw and gzip resource bytes.

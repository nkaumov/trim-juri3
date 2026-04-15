# Protocol Regression Runner

This runner tests the protocol-disagreement logic without the UI.
It reuses the same protocol engine as the API route and validates that
current protocol state stays clean, manual fields are preserved, and
duplicates are not introduced.

## Run

```bash
npm run protocol:test
```

## Fixtures

Scenarios live in `tests/protocol-fixtures/`.
Each case is a folder (for example `TC01`) with:

- `context.json` (templateText, rulesText, lawsText, protocolText)
- `step01.json`, `step02.json`, ...

Step fields:

- `type`: `client-points` | `client-freeform` | `client-protocol` | `edited-template` | `protocol-sync` | `manual-edit`
- `title`: short description
- `message` or `extractedText`
- `patchRows` for `manual-edit`
- `expectations` for assertions

## Output

Results are written to:

```
out/protocol-regression/<timestamp>/
```

Inside:

- `summary.json`, `summary.md`
- per-case folders with per-step snapshots:
  - `contract-state.json`
  - `protocol-rows.json`
  - `protocol-comments.json`
  - `request-log.json`
  - `step-result.json`

A zip archive is created next to the output folder on Windows using
`Compress-Archive`. If zip creation fails, the output folder is still kept
and the failure is recorded in `summary.json` / `summary.md`.

## Add a new scenario

1. Create a new folder under `tests/protocol-fixtures/TCxx`.
2. Add `context.json`.
3. Add `step01.json`, `step02.json`, etc.
4. Run `npm run protocol:test` and review the snapshots.

## Notes

- The runner uses a mock AI adapter. It focuses on protocol state logic,
  not on document parsing or model quality.
- Manual edits are applied via the `manual-edit` step and must be preserved
  by subsequent steps.

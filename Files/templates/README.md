# Templates

This directory holds the document templates Vichita fills: the risk assessment, the budget, and (v2) the sponsorship contract.

Its contents are intentionally **not committed**. The official LSESU templates and the placeholder-tagged copies derived from them are redistribution-sensitive, so they are gitignored (see **Template Policy** in the root `README.md`). A fresh clone will see this README and otherwise-empty/absent subfolders by design, not because anything is missing.

## Expected layout

```text
Files/templates/
  official_raw/   # Unmodified official templates, exactly as downloaded from your SU
  tagged/         # Copies with {{placeholder}} tags added; the automation reads these
  private/        # Any other society-private template material
  generated/      # Local generation scratch outputs
```

## Bringing your own templates (other societies)

1. Download your students' union's own current official templates into `official_raw/`. Do not assume LSESU's templates, deadlines, or approval rules apply to your SU.
2. Make a tagged copy of each in `tagged/`, inserting the `{{placeholder}}` tags. The exact tags and the cells/loops they map to are documented in `../docs/TEMPLATE_FIELD_MAP.md`. The internal form-field structure is in `../docs/LSESU_Form_Field_Pack_Template.md`.
3. Leave the `official_raw/` files untouched; the automation only reads the `tagged/` copies.

The runtime expects the tagged copies under `Files/templates/tagged/` (the risk-assessment generator refers to this path by name).

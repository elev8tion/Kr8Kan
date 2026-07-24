Broke the migration card into dependency-ordered steps.

```json
{
  "checklistName": "Breakdown",
  "items": [
    "Write the schema migration for the new column",
    "Backfill existing rows with a default value",
    "Update the repository layer to read the new column",
    "Add a unit test covering the new read path",
    "Remove the legacy fallback code"
  ]
}
```

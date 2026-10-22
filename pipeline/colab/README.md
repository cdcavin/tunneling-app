# Colab cells that built the live data (Oct 22, 2026)

Kept here as the source of truth for how `index.json.gz`, `pitchers/*.json.gz` and `reference.json.gz` in R2 were made.
The GitHub Action (`pipeline/tm_sync.py`, `pipeline/rows.py`) must produce the same ids, labels and fields.

1. `build_pitchers.py`: D1 (classifier `sub_type`) + WVU (home operator tags, away matched to home centroids), one file per pitcher (name + team).
2. `add_outcomes.py`: adds `result` (Batter's Eye event rules) and `ev` to every pitch; rewrites the pitcher files. Runs in the same runtime as 1 (`df2`).
3. `build_reference.py`: P4 / Big 12 separation reference (back-to-back pairs, 1-in bins of separation at 23.8 ft, raw outcome counts). Same runtime (`df2`).

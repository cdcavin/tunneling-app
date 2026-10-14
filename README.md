# WVU Pitch Tunneling

A tool for calling pitch sequences by how well two pitches tunnel. Pick a pitcher,
the pitch he just threw and where, and the pitch you're thinking about next. The app
draws both flights in 3D and shades every next-pitch location by how the pair
looks to the hitter.

**Status:** version 1, running on made-up sample pitchers. Real WVU data goes in
once the site is behind a login.

## What it measures

The data file holds every tracked pitch for each pitcher. Filters (outing, opponent,
pitch type, velo and break ranges) choose which pitches are in use, and each pitch
type the tool works with is the average of the selected pitches: release point,
release speed and movement from Trackman's 9-number trajectory fit. To put a pitch
at a location, the app keeps all of that and changes only the release direction,
so the shape stays his.

- **Apart at 23.8 ft:** how far apart the two pitches are 23.8 ft in front of the
  plate, roughly when a hitter has to commit. Smaller means the pitches look alike
  longer.
- **Apart at the plate:** how far apart they finish.
- **Late separation:** plate minus 23.8 ft, the separation the hitter has to react
  to after committing.
- **Extra flight time:** how much longer the next pitch takes to reach the plate.

The "best spot" is a placeholder rule (farthest apart at the plate while staying
within a set distance at 23.8 ft). The outcome model, trained on D1 pitch pairs,
replaces it with xWhiff and xWeakCon.

Side follows Trackman's PlateLocSide: positive is the third-base side. Zone grids
are drawn from the catcher's view.

## Working on it

```bash
npm install
npm run dev          # local preview at http://localhost:5173
npm test             # geometry tests
npm run build        # production build into dist/
npm run sample-data  # rebuild public/data/pitchers.json with sample pitchers
```

## Layout

- `src/lib/physics.ts` — trajectory math (time at a distance, position, re-aiming,
  pair separation). Covered by `physics.test.ts`.
- `src/lib/grid.ts` — the next-pitch location grid and the two lock-in rules.
- `src/lib/suggest.ts` — the shape-change search behind "Suggest changes".
- `src/lib/filters.ts` — outing, opponent, pitch type and shape filters.
- `src/components/` — 3D view, zone pickers, movement plot, separation chart.
- `public/data/pitchers.json` — the data the app loads, one row per pitch. Sample
  data only in git; real team data is never committed.

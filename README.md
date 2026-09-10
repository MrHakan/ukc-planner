# UKC Planner

A browser-based Dynamic Under Keel Clearance (UKC), squat, tidal-window and bridge air-clearance planning sandbox.

**Live:** https://mrhakan.github.io/ukc-planner/

## Features

- Static and dynamic UKC breakdown
- Forward / aft draft and mean-draft calculation
- Density draft correction using FWA
- Block coefficient calculation or manual Cb override
- Three selectable squat models:
  - Barrass empirical blockage model
  - simple confined-water estimate
  - simple open-water estimate
- Barrass width-of-influence and sectional blockage calculation
- Heel/list, wave, survey/CATZOC and other configurable allowances
- Fixed and percentage-of-draft UKC policy constraints
- Maximum safe-speed solver under enabled clearance constraints
- Squat-vs-speed and UKC-vs-speed charts
- Depth × speed squat matrix with requirement highlighting
- Scenario comparison, local save/load and printable report
- Transparent formula trace for every key calculation
- Responsive GitHub Pages UI; calculations run entirely in the browser

## Bridge / overhead-clearance planner

The bridge module combines charted vertical clearance with a user-defined reference tide level so it does not assume a specific chart datum convention:

```text
current bridge clearance
= charted vertical clearance
+ charted-clearance reference tide
− current tide
```

The vessel envelope is then evaluated as:

```text
effective air draft
= vessel air draft
+ vertical-motion allowance
+ bridge / vertical-survey allowance
− optional squat credit
```

The physical gap and operational margin are:

```text
physical gap = current bridge clearance − effective air draft
air-clearance margin = physical gap − required air-clearance margin
```

Squat credit is disabled by default to keep the overhead-clearance calculation conservative.

## Tidal Window Planner

Enter official high-water / low-water prediction events. The planner creates a smooth cosine interpolation between the entered extrema for visualization and what-if analysis, then evaluates every time step against both:

- dynamic UKC requirement
- enabled bridge air-clearance requirement

It reports combined safe windows, the limiting constraint, worst margin in each window and the speed ceiling at the worst point.

The interpolation is a planning approximation only; official tide predictions remain the authoritative source.

## Important safety note

This project is an **educational and passage-planning sandbox**, not an ECDIS, approved UKC management system, hydrographic product, bridge-clearance authority, or navigational instrument.

Do not use it as the sole basis for an operational navigation decision. Verify vessel particulars, drafts, air draft, official tide predictions, bathymetry, charted vertical clearance and its datum/reference level, bridge notes, CATZOC/survey uncertainty, squat methodology, environmental allowances, company SMS requirements and all safety margins against approved vessel/company procedures and official publications.

The CATZOC numeric allowances exposed by the UI are reference-style planning allowances and can be replaced/augmented by a manual allowance. CATZOC D and U intentionally do not assume a numeric accuracy value.

## Development

The app is deliberately static so it can run on GitHub Pages without a backend.

```text
index.html
styles.css
calc-engine.js
app.js
tests/calculation.mjs
.github/workflows/pages.yml
```

`calc-engine.js` is independent of the UI and can also be executed under Node for automated regression tests.

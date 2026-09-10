# UKC Planner

A browser-based Dynamic Under Keel Clearance (UKC), squat and speed-window planning sandbox.

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
- Maximum safe-speed solver under the selected UKC constraints
- Squat-vs-speed and UKC-vs-speed charts
- Depth × speed squat matrix with requirement highlighting
- Scenario comparison, local save/load and printable report
- Transparent formula trace for every key calculation
- Responsive GitHub Pages UI; calculations run entirely in the browser

## Important safety note

This project is an **educational and passage-planning sandbox**, not an ECDIS, approved UKC management system, hydrographic product, or navigational instrument.

Do not use it as the sole basis for an operational navigation decision. Verify vessel particulars, drafts, tide, density, bathymetry, CATZOC/survey uncertainty, squat methodology, environmental allowances, company SMS requirements and all safety margins against approved vessel/company procedures and official publications.

The CATZOC numeric allowances exposed by the UI are reference-style planning allowances and can be replaced/augmented by a manual allowance. CATZOC D and U intentionally do not assume a numeric accuracy value.

## Calculation model

The default empirical model uses:

```text
Mean draft:
T = (TF + TA) / 2

Displacement volume:
∇ = displacement / water density

Block coefficient:
Cb = ∇ / (LBP × B × T)

Barrass width of influence:
Wi = B × [7.7 + 20(1 − Cb)²]

Sectional blockage:
S = (B × T) / (W × H)

Empirical squat:
squat = Cb × S^0.81 × V^2.08 / 20
```

If no channel width is supplied, `Wi` is used as the effective width for the blockage estimate.

Two simplified alternatives are also selectable:

```text
Open water:     squat = Cb × V² / 100
Confined water: squat = 2 × Cb × V² / 100
```

Dynamic UKC is then evaluated as:

```text
total depth
− adjusted mean draft
− squat
− heel/list allowance
− wave allowance
− survey/CATZOC allowance
− other allowance
```

The required UKC is:

```text
max(fixed minimum UKC, required % × adjusted draft)
+ additional company margin
```

The Speed Advisor solves for the maximum speed at which available dynamic UKC remains greater than or equal to the selected required UKC.

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

`calc-engine.js` is independent of the UI and can also be executed under Node for automated tests.

## GitHub Pages

Pushes to `main` run syntax checks and calculation regression tests before deployment.

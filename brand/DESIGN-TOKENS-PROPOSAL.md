# HODL Brand Kit — Step 1 & 2 Proposals (Awaiting Approval)

> **Status:** Proposals + contrast only. No token files, no component edits, no Tailwind changes.
>
> **Important:** NO implementation until you approve this document. Reply approve (all or per-category edits) to proceed to Step 3.

Brand assets were extracted from `Final Files.zip` into `brand/` (the folder was empty). SVG source confirms brand hex values: `#6860FF`, `#ABAEF5`, `#161A40`.

---

## 1. Proposals — 7 Missing Categories

All values are derived from the brand anchor colors by holding hue (~244°) and stepping lightness/saturation.

| # | Category | Token / Role | Proposed Hex | Rationale |
|---|----------|--------------|--------------|-----------|
| **1** | **Price up** | `--price-up` (dark charts) | `#3DDBA8` | Mint-teal — reads “positive” on `#161A40`, avoids clashing with brand purple; 9.47:1 on chart bg |
| | | `--price-up` (light charts) | `#047857` | Darker teal for white backgrounds; passes AA for text |
| | | Chart line accent (dark) | `#4AE8B8` | Brighter variant for thin chart strokes |
| **1** | **Price down** | `--price-down` (dark charts) | `#FF6B7A` | Coral-rose — warm, not pure red; distinct from brand `#6860FF`; 6.08:1 on `#161A40` |
| | | `--price-down` (light charts) | `#DC2626` | Standard red for light bg; 4.83:1 on white |
| | | **Shape requirement** | ▲ / ▼ or +/- | **Required** — color alone is not sufficient (see §4) |
| **2** | **Surface colors** | `--surface-base` | `#161A40` | Brand dark anchor |
| | | `--surface-card` | `#1E2452` | +1 lightness step, same navy hue |
| | | `--surface-elevated` | `#252B62` | Modals, sheets, dropdowns |
| | | `--surface-hover` | `#2C336E` | Interactive row/button hover |
| | | `--surface-pressed` | `#121633` | Inset/pressed state, darker than base |
| **3** | **Borders & dividers** | `--border-default` | `#2E3568` | ~15% lift from base; subtle structure without competing with text |
| | | `--border-subtle` | `#252B62` | Same as elevated — hairline separation |
| | | `--divider` | `#323968` | Section dividers, list separators |
| | | `--border-focus` | `#ABAEF5` | Focus rings — brand secondary, 8.05:1 on dark |
| **4** | **Muted / secondary text** | `--text-primary` | `#F5F6FF` | Near-white with slight blue tint |
| | | `--text-secondary` | `#9EA2C8` | Desaturated `#ABAEF5`; 6.73:1 on `#161A40` |
| | | `--text-tertiary` | `#8B90AE` | Captions, timestamps; 4.69:1 on card surface |
| | | `--text-disabled` | `#4A4580` | ~35% opacity equivalent of secondary |
| **5** | **Error / warning / success** | `--success` | `#22C55E` | Pure green — confirmations, toasts; distinct from price-up teal |
| | | `--warning` | `#F59E0B` | Amber — alerts, pending states; no overlap with brand or price colors |
| | | `--error` | `#F87171` | Soft red — form errors, failures; redder than price-down coral |
| **6** | **#6860FF tint/shade scale** | `--brand-50` | `#F0EFFF` | Lightest tint — hover wash (light mode) |
| | | `--brand-100` | `#E0DEFF` | Pressed wash, selected bg |
| | | `--brand-200` | `#C4C2FF` | Disabled bg tint |
| | | `--brand-300` | `#ABAEF5` | Brand secondary (fixed) |
| | | `--brand-400` | `#8A85FF` | Link text on dark (5.48:1) |
| | | `--brand-500` | `#6860FF` | Brand primary (fixed) — buttons, accents |
| | | `--brand-600` | `#524BD4` | Button hover |
| | | `--brand-700` | `#3F3999` | Button pressed |
| | | `--brand-800` | `#2D2866` | Deep accent bg |
| | | `--brand-900` | `#1E1B45` | Deepest shade |
| | | `--brand-disabled` | `#6860FF` @ 35% opacity | Disabled button fill |
| | | `--brand-focus-ring` | `#ABAEF5` 2px + 2px offset | Keyboard focus |
| **7** | **Dark mode palette** (phone-first) | `--bg-base` | `#161A40` | Page background |
| | | `--bg-overlay` | `#0F1229` | Modal scrim layer |
| | | `--bg-input` | `#121633` | Form fields, search bars |
| | | `--accent` | `#6860FF` | CTAs, active tabs, links |
| | | `--accent-soft` | `#ABAEF5` | Secondary highlights, badges |
| | | `--scrollbar` | `rgba(171,174,245,0.16)` | Tinted from secondary |
| | | `--shadow-color` | `rgba(15,18,41,0.55)` | Purple-tinted shadows (not pure black) |
| | | `theme-color` meta | `#161A40` | Replaces current `#0A0B0B` |

**Light mode note (future step):** Wash `#F5F5FF`, elevated `#FAFAFF`, muted text `#525680` — derived from brand-50/100. Included for completeness; dark mode is the primary target.

---

## 2. WCAG 2.1 Contrast Results

Computed via relative luminance formula (WCAG 2.1). Thresholds: **Normal text ≥ 4.5:1**, **Large text ≥ 3.0:1**.

| Pair | Foreground | Background | Ratio | Normal | Large |
|------|------------|------------|------:|:------:|:-----:|
| Primary on dark surface | `#6860FF` | `#161A40` | **3.75:1** | FAIL | PASS |
| Primary on white | `#6860FF` | `#FFFFFF` | **4.46:1** | FAIL | PASS |
| Primary-400 on dark | `#8A85FF` | `#161A40` | **5.48:1** | PASS | PASS |
| Primary-400 on white | `#8A85FF` | `#FFFFFF` | **3.05:1** | FAIL | PASS |
| Secondary on white | `#ABAEF5` | `#FFFFFF` | **2.08:1** | FAIL | FAIL |
| Secondary on dark surface | `#ABAEF5` | `#161A40` | **8.05:1** | PASS | PASS |
| Secondary on card | `#ABAEF5` | `#1E2452` | **7.07:1** | PASS | PASS |
| Dark on white | `#161A40` | `#FFFFFF` | **16.72:1** | PASS | PASS |
| White on primary | `#FFFFFF` | `#6860FF` | **4.46:1** | FAIL | PASS |
| White on primary hover | `#FFFFFF` | `#524BD4` | **6.33:1** | PASS | PASS |
| White on dark surface | `#FFFFFF` | `#161A40` | **16.72:1** | PASS | PASS |
| Primary text on dark | `#F5F6FF` | `#161A40` | **15.53:1** | PASS | PASS |
| Secondary text on dark | `#9EA2C8` | `#161A40` | **6.73:1** | PASS | PASS |
| Secondary text on elevated | `#9EA2C8` | `#252B62` | **5.28:1** | PASS | PASS |
| Tertiary text on dark | `#8B90AE` | `#161A40` | **4.82:1** | PASS | PASS |
| Tertiary text on card | `#8B90AE` | `#1E2452` | **4.69:1** | PASS | PASS |
| Price up on chart (dark) | `#3DDBA8` | `#161A40` | **9.47:1** | PASS | PASS |
| Price down on chart (dark) | `#FF6B7A` | `#161A40` | **6.08:1** | PASS | PASS |
| Price up on white | `#047857` | `#FFFFFF` | **5.48:1** | PASS | PASS |
| Price down on white | `#DC2626` | `#FFFFFF` | **4.83:1** | PASS | PASS |
| Success on dark | `#22C55E` | `#161A40` | **7.34:1** | PASS | PASS |
| Error on dark | `#F87171` | `#161A40` | **6.04:1** | PASS | PASS |
| Warning on dark | `#F59E0B` | `#161A40` | **7.79:1** | PASS | PASS |
| Muted on white (light mode) | `#525680` | `#FFFFFF` | **7.00:1** | PASS | PASS |
| Border on base | `#2E3568` | `#161A40` | **1.45:1** | N/A | N/A |

---

## 3. Failures & Recommendations

| Failing pair | Ratio | Verdict |
|--------------|------:|---------|
| `#6860FF` on `#161A40` / `#FFFFFF` | 3.75 / 4.46 | **Accent only** — links, icons, badges, large labels. Use `#8A85FF` (brand-400) for small link text on dark. |
| `#ABAEF5` on `#FFFFFF` | 2.08 | **Accent only on light** — never body text on white. Use `#525680` for muted text in light mode. |
| `#FFFFFF` on `#6860FF` (button label) | 4.46 | **Large/bold button text only**, or use `#524BD4` (brand-600) as button bg for AA-compliant white labels. |
| `#6860FF` on `#F0EFFF` (hover wash) | 3.93 | Decorative/hover bg only — not for text. |

**Recommended rules:**
- Body text on dark → `#F5F6FF` (primary), `#9EA2C8` (secondary), `#8B90AE` (tertiary)
- Interactive accent → `#6860FF` at ≥14px bold or ≥18px regular
- Button default → bg `#6860FF`, but prefer `#524BD4` hover bg with white text (6.33:1)
- Focus rings → `#ABAEF5` (passes on all dark surfaces)

---

## 4. Colorblind Check

| Condition | Up `#3DDBA8` vs Down `#FF6B7A` | Up vs Success `#22C55E` | Down vs Error `#F87171` |
|-----------|----------------------------------|-------------------------|-------------------------|
| **Protanopia** (red-blind) | Distinguishable — teal vs warm coral | Similar hue family; different context (number vs toast) | Distinguishable — coral vs true red |
| **Deuteranopia** (green-blind) | Distinguishable — blue-green vs pink | Moderate risk — both read “greenish”; keep separate UI zones | Distinguishable |
| **Tritanopia** (blue-blind) | Distinguishable | Distinguishable | Distinguishable |

**Recommendation:** Always pair price colors with **▲/▼** (or **+/-**) icons. Never rely on color alone for P&L direction. Consider adding a subtle prefix (`+2.4%` / `-1.1%`) which carries meaning independent of hue.

Success/error states should use **icons + text** (checkmark, warning triangle, X) in addition to `#22C55E` / `#F87171`.

---

## 5. Asset Inventory — `brand/`

Extracted from `Final Files.zip` → `brand/` (103 files total).

### SVG (7 files) — primary web assets

| File | Use case |
|------|----------|
| `SVG/Logo.svg` | Full wordmark — fist + HODL (gradient `#6860FF→#ABAEF5`, text `#161A40`) |
| `SVG/Logo & White Text.svg` | Wordmark for dark backgrounds |
| `SVG/Black Logo.svg` | Monochrome dark logo |
| `SVG/White Logo.svg` | Monochrome light logo |
| `SVG/Icon.svg` | Fist icon only (gradient) |
| `SVG/Black Icon.svg` | Monochrome fist |
| `SVG/White Icon.svg` | Monochrome fist (light) |

### Favicon (5 files)

| File | Size |
|------|------|
| `Favicon/__favicon 16x16.png` | 16×16 |
| `Favicon/__favicon 32x32.png` | 32×32 |
| `Favicon/__favicon 64x64.png` | 64×64 |
| `Favicon/__favicon 128x128.png` | 128×128 |
| `Favicon/favicon.ai` | Source |

### Apps Icon (15 files)

- **PNG (8):** Color, white, black backgrounds + 20% rounded variants
- **SVG (6):** Same variants in vector
- **Source:** `IOS & Android Icon Vector File.ai`

### PNG Transparent (8 files)

| File | Use case |
|------|----------|
| `__Logo.png` | Full logo, transparent bg |
| `__Logo & White Text.png` | Dark-bg wordmark |
| `__Icon.png` | Fist icon, transparent |
| `__Black Logo.png` / `__White Logo.png` | Monochrome variants |
| `__Black Icon.png` / `__White Icon.png` | Monochrome icons |

### Also included (reference only, not for web deployment)

- `Brand Style Guides - PDF.pdf` + `.ai`
- EPS (10), JPG (12), PDF (10), Social Media Kits, Vector source files

---

## 6. Implementation Preview (NOT built yet)

Pending your approval, Step 3 would:

### Token file structure

```
src/styles/brand-tokens.css     ← single source of truth (CSS custom properties)
src/app/globals.css             ← imports brand-tokens.css, maps :root + html.dark
tailwind.config.ts              ← extend colors to var(--*) references
```

Example token naming:

```css
--brand-500: #6860FF;
--surface-base: #161A40;
--text-secondary: #9EA2C8;
--price-up: #3DDBA8;
```

Tailwind aliases: `bg-brand`, `text-muted`, `border-hairline`, etc.

### Typography

- Replace `Inter_Tight` → **`Inter`** via `next/font/google`
- Weights: **300** (Light body), **500** (Medium headings), **700** (Bold headings)
- Line-height rule: `font-size + 8px` (e.g. 16px → 24px line-height)
- Keep `JetBrains_Mono` for addresses/hashes

### Logo placement (planned)

| Location | Asset |
|----------|-------|
| `src/app/icon.tsx` | `SVG/Icon.svg` or favicon PNG |
| `src/app/apple-icon.tsx` | Apps Icon color PNG |
| `src/app/manifest.ts` | Apps Icon 512 PNG |
| App header / splash | `SVG/Logo & White Text.svg` (dark mode) |
| OG / social share | `PNG/__Logo.png` |
| `theme-color` meta | `#161A40` |

---

## Approval Checklist

Please review and approve/reject each category:

- [ ] **1. Price up/down** — teal `#3DDBA8` / coral `#FF6B7A` + mandatory ▲/▼
- [ ] **2. Surface colors** — `#161A40` base ladder
- [ ] **3. Borders/dividers** — `#2E3568` / `#323968`
- [ ] **4. Muted text** — `#9EA2C8` / `#8B90AE`
- [ ] **5. Error/warning/success** — `#F87171` / `#F59E0B` / `#22C55E`
- [ ] **6. Brand scale** — 50–900 from `#6860FF`
- [ ] **7. Dark mode palette** — full phone-night scheme
- [ ] **Contrast rules** — accent-only restrictions accepted
- [ ] **Assets** — confirm `brand/` inventory is complete

Reply **approve** (all or per-category edits) to proceed to Step 3 (token file + Tailwind wiring). No code will be written until then.

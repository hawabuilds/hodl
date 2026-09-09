/**
 * WCAG 2.1 contrast ratios for terminal palette restructure.
 * Run: node scripts/_palette-contrast.mjs
 */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const l1 = relLuminance(hexToRgb(fg));
  const l2 = relLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function grade(ratio, large = false) {
  const min = large ? 3.0 : 4.5;
  return ratio >= min ? "PASS" : "FAIL";
}

const terminal = {
  bgBase: "#0D0F18",
  surfaceCard: "#161A40",
  chartBg: "#0D0F18",
};

const legacy = {
  bgBase: "#161A40",
  surfaceCard: "#1E2452",
  chartBg: "#161A40",
};

const fg = {
  textPrimary: "#F5F6FF",
  textSecondary: "#9EA2C8",
  textTertiary: "#8B90AE",
  priceUp: "#3DDBA8",
  priceDown: "#FF6B7A",
  brand500: "#6860FF",
  brand400: "#8A85FF",
  brand300: "#ABAEF5",
  white: "#FFFFFF",
  warning: "#F59E0B",
  borderDefault: "#2E3568",
  borderSubtle: "#1E2452",
  divider: "#323968",
};

const pairs = [
  ["text-primary on base", "textPrimary", "bgBase"],
  ["text-secondary on base", "textSecondary", "bgBase"],
  ["text-tertiary on base", "textTertiary", "bgBase"],
  ["text-primary on card", "textPrimary", "surfaceCard"],
  ["text-secondary on card", "textSecondary", "surfaceCard"],
  ["text-tertiary on card", "textTertiary", "surfaceCard"],
  ["price-up on base", "priceUp", "bgBase"],
  ["price-down on base", "priceDown", "bgBase"],
  ["price-up on chart (base)", "priceUp", "chartBg"],
  ["price-down on chart (base)", "priceDown", "chartBg"],
  ["#6860FF on base", "brand500", "bgBase"],
  ["#6860FF on card", "brand500", "surfaceCard"],
  ["#8A85FF on base", "brand400", "bgBase"],
  ["#8A85FF on card", "brand400", "surfaceCard"],
  ["#ABAEF5 on base", "brand300", "bgBase"],
  ["#ABAEF5 on card", "brand300", "surfaceCard"],
  ["white bold on #6860FF btn", "white", "brand500", true],
  ["warning on base", "warning", "bgBase"],
  ["border-default on base", "borderDefault", "bgBase"],
  ["border-default on card", "borderDefault", "surfaceCard"],
  ["divider on base", "divider", "bgBase"],
];

function runTable(name, palette) {
  console.log(`\n## ${name}\n`);
  console.log("| Pair | FG | BG | Ratio | Normal | Large |");
  console.log("|------|----|----|------:|:------:|:-----:|");

  for (const row of pairs) {
    const [label, fgKey, bgKey, fgBgPair] = row;
    const fgHex = fg[fgKey];
    const bgHex = fgBgPair ? fg[bgKey] : palette[bgKey];
    const ratio = contrast(fgHex, bgHex);
    const largeOnly =
      label.includes("#6860FF") ||
      label.includes("white bold") ||
      label.includes("border") ||
      label.includes("divider");
    const normal = grade(ratio, false);
    const large = grade(ratio, true);
    console.log(
      `| ${label} | \`${fgHex}\` | \`${bgHex}\` | **${ratio.toFixed(2)}:1** | ${largeOnly ? "N/A" : normal} | ${large} |`,
    );
  }
}

console.log("# Palette contrast — WCAG 2.1 AA");
console.log("\nChosen base: **#0D0F18** (hue ~244°, L≈7%, between #0B0D18–#0F1119)");
runTable("Terminal (Version B — proposed default)", terminal);
runTable("Legacy (Version A — Step 3 deploy)", legacy);

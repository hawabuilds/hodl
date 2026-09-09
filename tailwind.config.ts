import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          300: "var(--brand-300)",
          400: "var(--brand-400)",
          500: "var(--brand-500)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
          DEFAULT: "var(--brand-500)",
        },
        surface: {
          base: "var(--surface-base)",
          card: "var(--surface-card)",
          elevated: "var(--surface-elevated)",
          hover: "var(--surface-hover)",
          pressed: "var(--surface-pressed)",
          popup: "var(--surface-popup)",
          input: "var(--bg-input)",
        },
        input: {
          DEFAULT: "var(--bg-input)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          disabled: "var(--text-disabled)",
        },
        price: {
          up: "var(--price-up)",
          down: "var(--price-down)",
        },
        success: "var(--success)",
        error: "var(--error)",
        warning: "var(--warning)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          link: "var(--accent-link)",
        },
        /* Legacy aliases — card follows --card (surface-card in terminal, base in legacy) */
        card: "var(--card)",
        ink: "var(--text-primary)",
        muted: "var(--text-secondary)",
        faint: "var(--text-tertiary)",
        wash: "var(--surface-hover)",
        hairline: "var(--border-default)",
        green: {
          DEFAULT: "var(--price-up)",
          deep: "var(--price-up)",
        },
        red: {
          DEFAULT: "var(--price-down)",
        },
        "btn-dark": {
          DEFAULT: "var(--btn-primary-bg)",
          fg: "var(--btn-primary-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        card: "18px",
        panel: "20px",
        control: "14px",
        pill: "11px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
        panel: "var(--shadow-panel)",
        modal: "var(--shadow-modal)",
        frame: "var(--shadow-frame)",
        menu: "var(--shadow-menu)",
        dark: "var(--shadow-dark)",
        brand: "var(--shadow-brand)",
        green: "var(--shadow-price-up)",
        "price-up": "var(--shadow-price-up)",
        "price-down": "var(--shadow-price-down)",
        "tab-active": "var(--shadow-tab-active)",
        "inset-soft": "var(--shadow-inset-soft)",
        "inset-focus": "var(--shadow-inset-focus)",
      },
      backgroundImage: {
        premium: "var(--premium-bg)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        nudge: {
          "0%,100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-5px)" },
          "75%": { transform: "translateX(5px)" },
        },
      },
      animation: {
        rise: "rise .35s ease",
        nudge: "nudge .4s ease",
      },
      transitionTimingFunction: {
        sheet: "cubic-bezier(.2,.9,.25,1)",
      },
    },
  },
  plugins: [],
};

export default config;

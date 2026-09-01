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
        card: "var(--card)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        wash: "var(--wash)",
        hairline: "var(--hairline)",
        green: {
          DEFAULT: "var(--green)",
          deep: "var(--green-deep)",
        },
        red: {
          DEFAULT: "var(--red)",
        },
        "btn-dark": {
          DEFAULT: "var(--btn-dark-bg)",
          fg: "var(--btn-dark-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
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
        green: "var(--shadow-green)",
      },
      backgroundImage: {
        premium: "var(--premium-bg)",
        flex:
          "linear-gradient(150deg, #0B0F0C, #10261A 70%, #0B3D1F)",
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

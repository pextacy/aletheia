import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#faf6ee",
        ink: "#1c1a17",
        oxblood: "#7a2e2e",
        "oxblood-dark": "#5e2323",
        "ink-soft": "#4a4540",
        line: "#d8d0c0",
      },
      fontFamily: {
        display: ["var(--font-cormorant)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;

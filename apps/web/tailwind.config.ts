import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0b0a14",
          800: "#141222",
          700: "#1d1a30",
          600: "#2a2643",
          500: "#3b3560"
        },
        sakura: {
          400: "#ff9ec4",
          500: "#ff7fb0",
          600: "#e85f95"
        },
        spirit: {
          400: "#7fd8ff",
          500: "#4cc3f5"
        }
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;

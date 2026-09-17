import type { Config } from "tailwindcss";

/**
 * 主题色通过 CSS 变量驱动：
 * - `ink-*` 是页面 / 面板 / 输入框的明暗层级；
 * - `white` 被重映射为「前景反色」，夜间=白色、白天=深色，
 *   这样全站 `text-white/70`、`border-white/10` 之类的写法可以自动跟随主题；
 * - `ink-onAccent` 是亮色强调按钮上的固定深色文字，两种主题下都不变。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "rgb(var(--ink-900) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          onAccent: "#0b0a14"
        },
        white: "rgb(var(--white) / <alpha-value>)",
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
        sans: [
          "PingFang SC",
          "HarmonyOS Sans SC",
          "MiSans",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "Noto Sans SC",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif"
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;

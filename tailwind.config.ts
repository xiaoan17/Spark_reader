import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        ui: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        reading: [
          "Songti SC",
          "STSong",
          "Noto Serif CJK SC",
          "serif",
        ],
      },
      transitionDuration: {
        interactive: "100ms",
        subtle: "200ms",
        moderate: "300ms",
        reveal: "500ms",
      },
      transitionTimingFunction: {
        reader: "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "citation-pulse": {
          "0%": { backgroundColor: "rgb(186 230 253 / 0.75)", boxShadow: "0 0 0 0 rgb(14 165 233 / 0)" },
          "28%": { backgroundColor: "rgb(254 240 138 / 0.9)", boxShadow: "0 0 0 4px rgb(245 158 11 / 0.22)" },
          "70%": { backgroundColor: "rgb(186 230 253 / 0.55)", boxShadow: "0 0 0 1px rgb(14 165 233 / 0.16)" },
          "100%": { backgroundColor: "rgb(186 230 253 / 0)", boxShadow: "0 0 0 0 rgb(14 165 233 / 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.2, 0, 0, 1)",
        "slide-in-up": "slide-in-up 220ms cubic-bezier(0.2, 0, 0, 1)",
        "scale-in": "scale-in 160ms cubic-bezier(0.2, 0, 0, 1)",
        "pop-in": "pop-in 140ms cubic-bezier(0.2, 0, 0, 1)",
        shimmer: "shimmer 1.3s linear infinite",
        "citation-pulse": "citation-pulse 1500ms cubic-bezier(0.2, 0, 0, 1) 1",
      },
    },
  },
  plugins: [],
}

export default config

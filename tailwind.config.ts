/* eslint-disable @typescript-eslint/no-require-imports */
import defaultTheme from "tailwindcss/defaultTheme";
import type { Config } from "tailwindcss";

// Keep custom colors for backwards compatibility, but we'll primarily use Tailwind defaults
import colorsJson from "./colors.json";

const customColors = Object.keys(colorsJson).reduce(
  (acc, key) => {
    acc[key] = `var(--${key})`;
    return acc;
  },
  {} as Record<string, string>
);

const themeConfig: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components-new/**/*.{js,ts,jsx,tsx,mdx}",
    "./styling-reference/ai-ready-website/app/**/*.{ts,tsx}",
    "./styling-reference/ai-ready-website/components/**/*.{ts,tsx}",
    "./styling-reference/ai-ready-website/components-new/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    // Use Tailwind's default theme, only extend what's necessary
    extend: {
      fontFamily: {
        sans: ["\"Tomato Grotesk\"", "Inter", ...defaultTheme.fontFamily.sans],
        mono: [...defaultTheme.fontFamily.mono],
        ascii: ["var(--font-roboto-mono)", ...defaultTheme.fontFamily.mono]
      },
      // Custom font sizes (these are fine to keep)
      fontSize: {
        "title-h1": ["60px", { lineHeight: "64px", letterSpacing: "-0.3px", fontWeight: "500" }],
        "title-h2": ["52px", { lineHeight: "56px", letterSpacing: "-0.52px", fontWeight: "500" }],
        "title-h3": ["40px", { lineHeight: "44px", letterSpacing: "-0.4px", fontWeight: "500" }],
        "title-h4": ["32px", { lineHeight: "36px", letterSpacing: "-0.32px", fontWeight: "500" }],
        "title-h5": ["24px", { lineHeight: "32px", letterSpacing: "-0.24px", fontWeight: "500" }],
        "body-x-large": ["20px", { lineHeight: "28px", letterSpacing: "-0.1px", fontWeight: "400" }],
        "body-large": ["16px", { lineHeight: "24px", letterSpacing: "0px", fontWeight: "400" }],
        "body-medium": ["14px", { lineHeight: "20px", letterSpacing: "0.14px", fontWeight: "400" }],
        "body-small": ["13px", { lineHeight: "20px", letterSpacing: "0px", fontWeight: "400" }],
        "body-input": ["15px", { lineHeight: "24px", letterSpacing: "0px", fontWeight: "400" }],
        "label-x-large": ["20px", { lineHeight: "28px", letterSpacing: "-0.1px", fontWeight: "450" }],
        "label-large": ["16px", { lineHeight: "24px", letterSpacing: "0px", fontWeight: "450" }],
        "label-medium": ["14px", { lineHeight: "20px", letterSpacing: "0.14px", fontWeight: "450" }],
        "label-small": ["13px", { lineHeight: "20px", letterSpacing: "0px", fontWeight: "450" }],
        "label-x-small": ["12px", { lineHeight: "20px", letterSpacing: "0px", fontWeight: "450" }],
        "mono-medium": ["14px", { lineHeight: "22px", letterSpacing: "0px", fontWeight: "400" }],
        "mono-small": ["13px", { lineHeight: "20px", letterSpacing: "0px", fontWeight: "500" }],
        "mono-x-small": ["12px", { lineHeight: "16px", letterSpacing: "0px", fontWeight: "400" }],
        "title-blog": ["28px", { lineHeight: "36px", letterSpacing: "-0.28px", fontWeight: "500" }]
      },
      colors: {
        // Shadcn/ui CSS variable colors
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Legacy custom colors (for backwards compatibility with old components)
        ...customColors
      },
      // Only add custom spacing values, don't override defaults
      spacing: {
        'root': 'var(--root-padding)'
      },
      // Custom screen breakpoints (extend, don't replace)
      screens: {
        xs: "390px",
        "3xl": "1600px",
      },
      // Border radius uses Tailwind defaults, just add CSS variable support for Shadcn
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        inherit: "inherit",
        "2": "2px",
        "3": "3px",
        "4": "4px",
        "6": "6px",
        "8": "8px",
        "10": "10px",
        "12": "12px",
        "16": "16px",
        "20": "20px",
      },
      // Keep custom transition timing
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.25, 0.1, 0.25, 1)"
      },
    }
  },
  plugins: [
    ({ addUtilities }: { addUtilities: (utilities: Record<string, Record<string, string>>) => void }) => {
      addUtilities({
        '.mask-border': {
          "mask": "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          "mask-composite": "exclude",
          "pointer-events": "none"
        },
        ".center-x": { "@apply absolute left-1/2 -translate-x-1/2": "" },
        ".center-y": { "@apply absolute top-1/2 -translate-y-1/2": "" },
        ".center": { "@apply absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2": "" },
        ".flex-center": { "@apply flex items-center justify-center": "" },
        ".overlay": { "@apply absolute top-0 left-0 w-full h-full rounded-inherit": "" },
        ".text-gradient": { "@apply !bg-clip-text !text-transparent": "" }
      });
    },
    require("tailwind-gradient-mask-image"),
    require("@tailwindcss/typography"),
  ]
};

export default themeConfig;

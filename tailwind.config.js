module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0066cc",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#f4f4f5",
          foreground: "#1f2937",
        },
        destructive: {
          DEFAULT: "#dc2626",
        },
        accent: {
          DEFAULT: "#f5f3ff",
          foreground: "#1f2937",
        },
        muted: {
          DEFAULT: "#f9fafb",
          foreground: "#374151",
        },
        background: "#ffffff",
        foreground: "#1f2937",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#1f2937",
        },
        border: "#e5e7eb",
        input: "#f9fafb",
        ring: "#e5e7eb",
        storefront: {
          charcoal: "#1C1917",
          gold: "#A16207",
          "gold-dark": "#92400E",
          cream: "#FAFAF9",
          warm: "#44403C",
          muted: "#78716C",
          border: "#D6D3D1",
          card: "#FFFFFF",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: [
          '"Inter"',
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        // Back-compat aliases (old class names still resolve to new fonts)
        cormorant: ['"Fraunces"', "Georgia", "serif"],
        montserrat: ['"Inter"', "sans-serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

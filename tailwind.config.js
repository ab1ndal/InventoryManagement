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
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

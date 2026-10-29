/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lavender: { DEFAULT: "#E9E3FF", deep: "#7968C9", soft: "#F4F1FF" },
        mint: { DEFAULT: "#DDF2F1", deep: "#3E9C8F", soft: "#EEF8F7" },
        sky: { DEFAULT: "#E6F5FF", deep: "#4A90C8" },
        canvas: "#FAFBFD",
        ink: "#202124",
        muted: "#7B8290",
        line: "#EEF0F4",
        success: "#58B99B",
        warning: "#F4B860",
        danger: "#F27C83",
        peach: "#FDEBD3",
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"] },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        soft: "0 12px 32px -16px rgba(32,33,36,0.16), 0 2px 6px -2px rgba(32,33,36,0.05)",
        float: "0 20px 48px -20px rgba(55,48,107,0.28), 0 4px 12px -4px rgba(32,33,36,0.08)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.7)",
      },
      keyframes: {
        rise: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "none" } },
        pulseRing: { "0%": { transform: "scale(.8)", opacity: .7 }, "100%": { transform: "scale(2.2)", opacity: 0 } },
      },
      animation: { rise: "rise .35s ease-out both", pulseRing: "pulseRing 1.8s ease-out infinite" },
    },
  },
  plugins: [],
};

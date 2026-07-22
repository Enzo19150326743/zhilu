import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        line: "0 1px 0 rgba(24, 24, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

import preset from "@kr8kan/tailwind-config";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  presets: [preset as Config],
  plugins: [typography],
};

export default config;

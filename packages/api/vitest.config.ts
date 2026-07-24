import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Importing @kr8kan/api boots the db singleton; parallel test files
    // must not share the on-disk PGlite dir (wasm aborts on contention).
    env: {
      KR8KAN_PGLITE_DIR: "memory://",
      POSTGRES_URL: "",
    },
  },
});

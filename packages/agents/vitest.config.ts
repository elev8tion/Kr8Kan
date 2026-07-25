import { defineConfig } from "vitest/config";

// Runner/sandbox tests mutate process.env (PI_BIN, KR8KAN_PI_*). Vitest's
// default parallel file execution shares process.env across threads, so
// concurrent files race each other's env and sandbox runs can silently
// fall back to live-edit mode mid-test. Serialize file execution.
export default defineConfig({
  test: { fileParallelism: false },
});

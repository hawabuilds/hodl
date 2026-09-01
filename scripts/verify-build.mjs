import {spawnSync} from "node:child_process";

/**
 * A production build that cannot disturb a running dev server.
 *
 * `next build` and `next dev` write incompatible chunk maps into the same
 * directory, so building while the dev server is up leaves it requiring
 * modules that no longer exist. This points the build at its own output
 * directory instead, which `next.config.mjs` reads from BUILD_DIR.
 *
 * Set as an env var here rather than inline in the npm script because npm runs
 * scripts through cmd.exe on Windows, where `VAR=value cmd` is not a thing.
 */
const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: {...process.env, BUILD_DIR: ".next-verify"},
});

process.exit(result.status ?? 1);

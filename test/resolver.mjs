/**
 * Lets the test runner follow the app's own import style.
 *
 * Source here is written for a bundler, so imports have no file extension and
 * `@/` points at `src/`. Node's ESM resolver does neither. Rather than rewrite
 * hundreds of imports to suit the test runner, this teaches the runner to read
 * them: try the specifier as written, and on failure try it as `.ts`, `.tsx`,
 * or a directory index.
 */
import {register} from "node:module";
import {pathToFileURL} from "node:url";

const SOURCE = new URL("../src/", import.meta.url).href;

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const SOURCE = ${JSON.stringify(SOURCE)};
      const SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

      export async function resolve(specifier, context, next) {
        const mapped = specifier.startsWith("@/")
          ? new URL(specifier.slice(2), SOURCE).href
          : specifier;

        let lastError;
        for (const suffix of SUFFIXES) {
          try {
            return await next(mapped + suffix, context);
          } catch (error) {
            lastError ??= error;
          }
        }
        throw lastError;
      }
    `),
  pathToFileURL("./"),
);

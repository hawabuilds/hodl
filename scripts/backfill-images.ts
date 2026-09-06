/**
 * Fill null image_url and stale/missing socials on eligible listed tokens.
 * Keyset on address via DATABASE_URL. Small pages, pause, Dex 429 backoff.
 * Images and socials share one persist pass (one Dex batch).
 *
 *   npm run backfill:images
 *
 * Stale socials: socials_checked_at is null or older than 7 days.
 */
import {createAdminPool} from "../src/lib/server/live/adminPg";
import {isDexRateLimit, noteDex429} from "../src/lib/server/live/dexscreener";
import {persistResolvedMedia} from "../src/lib/server/live/tokenImages";
import {runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import type {LaunchpadId} from "../src/lib/universe";
import type pg from "pg";

type Row = {address: string; launchpad: string | null};

const PAGE = 8;
const PAUSE_MS = 1_500;
const STALE_DAYS = 7;
const JOB = "backfill:media:eligible";

const LISTED_ELIGIBLE = `
  status = 'listed'
  and eligible is distinct from false
`;

const NEEDS_MEDIA = `
  (
    image_url is null
    or socials_checked_at is null
    or socials_checked_at < now() - interval '${STALE_DAYS} days'
  )
`;

async function coverage(client: pg.PoolClient): Promise<{
  eligibleListed: number;
  missingImages: number;
  missingSocials: number;
  imageSources: {image_source: string | null; count: number}[];
  socialSources: {socials_source: string | null; count: number}[];
  columnsMissing?: boolean;
}> {
  const listed = await client.query<{n: string}>(
    `select count(*)::text as n from tokens where ${LISTED_ELIGIBLE}`,
  );
  try {
    const [missingImages, missingSocials, imageSources, socialSources] = await Promise.all([
      client.query<{n: string}>(
        `select count(*)::text as n from tokens
         where ${LISTED_ELIGIBLE} and image_url is null`,
      ),
      client.query<{n: string}>(
        `select count(*)::text as n from tokens
         where ${LISTED_ELIGIBLE}
           and twitter is null and telegram is null
           and website is null and discord is null`,
      ),
      client.query<{image_source: string | null; count: string}>(
        `select image_source, count(*)::text as count
         from tokens
         where ${LISTED_ELIGIBLE}
         group by image_source
         order by count(*) desc`,
      ),
      client.query<{socials_source: string | null; count: string}>(
        `select socials_source, count(*)::text as count
         from tokens
         where ${LISTED_ELIGIBLE}
         group by socials_source
         order by count(*) desc`,
      ),
    ]);
    return {
      eligibleListed: Number(listed.rows[0]?.n ?? 0),
      missingImages: Number(missingImages.rows[0]?.n ?? 0),
      missingSocials: Number(missingSocials.rows[0]?.n ?? 0),
      imageSources: imageSources.rows.map((row) => ({
        image_source: row.image_source,
        count: Number(row.count),
      })),
      socialSources: socialSources.rows.map((row) => ({
        socials_source: row.socials_source,
        count: Number(row.count),
      })),
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/twitter|telegram|website|discord|socials_source|socials_checked/i.test(text)) {
      return {
        eligibleListed: Number(listed.rows[0]?.n ?? 0),
        missingImages: 0,
        missingSocials: 0,
        imageSources: [],
        socialSources: [],
        columnsMissing: true,
      };
    }
    throw error;
  }
}

async function main() {
  const pool = await createAdminPool({max: 2, idleTimeoutMillis: 10_000});
  const withClient = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  };

  try {
    const before = await withClient(coverage);
    console.log(JSON.stringify({phase: "before", ...before}));
    if (before.columnsMissing) {
      console.warn("paste scripts/schema-socials.sql before socials backfill");
    }

    const result = await runKeysetBatch<Row>({
      name: JOB,
      pageSize: PAGE,
      pauseMs: PAUSE_MS,
      continueOnPageError: true,
      readCursor: (name) =>
        withClient(async (client) => {
          const {rows} = await client.query<{last_key: string | null; scanned: string}>(
            `select last_key, scanned::text as scanned
             from batch_cursors where name = $1`,
            [name],
          );
          return {
            lastKey: rows[0]?.last_key ?? null,
            scanned: Number(rows[0]?.scanned ?? 0) || 0,
          };
        }).catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          if (/batch_cursors/i.test(text)) {
            console.warn("batch_cursors missing — paste scripts/schema-batch-cursors.sql");
            return {lastKey: null, scanned: 0};
          }
          throw error;
        }),
      writeCursor: (name, lastKey, scanned) =>
        withClient((client) =>
          client.query(
            `insert into batch_cursors (name, last_key, scanned, updated_at)
             values ($1, $2, $3, now())
             on conflict (name) do update
               set last_key = excluded.last_key,
                   scanned = excluded.scanned,
                   updated_at = excluded.updated_at`,
            [name, lastKey, scanned],
          ),
        ).then(() => undefined),
      loadPage: (after, limit) =>
        withClient(async (client) => {
          try {
            const {rows} = await client.query<Row>(
              `select address, launchpad
               from tokens
               where ${LISTED_ELIGIBLE}
                 and ${NEEDS_MEDIA}
                 and ($1::text is null or address > $1)
               order by address
               limit $2`,
              [after, limit],
            );
            return rows;
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            if (/socials_checked_at|twitter|telegram|website|discord/i.test(text)) {
              console.warn("socials columns missing — image-only page; paste scripts/schema-socials.sql");
              const {rows} = await client.query<Row>(
                `select address, launchpad
                 from tokens
                 where ${LISTED_ELIGIBLE}
                   and image_url is null
                   and ($1::text is null or address > $1)
                 order by address
                 limit $2`,
                [after, limit],
              );
              return rows;
            }
            throw error;
          }
        }),
      keyOf: (row) => row.address,
      async onPage(page) {
        try {
          const wrote = await persistResolvedMedia(
            page.map((row) => ({
              address: row.address,
              launchpad: (row.launchpad as LaunchpadId | null) ?? null,
            })),
          );
          return {wrote: wrote.images, socials: wrote.socials};
        } catch (error) {
          if (isDexRateLimit(error)) {
            noteDex429();
            console.warn("dex 429; backing off 15s");
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            return {rateLimited: 1};
          }
          throw error;
        }
      },
    });

    const after = await withClient(coverage);
    console.log(
      JSON.stringify({
        done: true,
        before,
        after,
        resolved: result.extra.wrote ?? 0,
        socials: result.extra.socials ?? 0,
        scanned: result.scanned,
        pages: result.pages,
        tokensPerMin: result.tokensPerMin,
        ms: result.ms,
        extra: result.extra,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Full-table chart orientation audit.
 *
 *   npm run audit:charts
 *
 * Reports how many listed universe tokens are inverted on their deepest
 * pool, how many the sanity guard hides, and how many of the original
 * Gecko-page-1 31 now render a token price.
 */
import {createClient} from "@supabase/supabase-js";
import {RWA_BY_ADDRESS, RWA_REGISTRY} from "../src/lib/server/live/robinhood";
import {pairsForAddresses, type DexPair} from "../src/lib/server/live/dexscreener";
import {looksInvertedMemecoin, usdPriceFor} from "../src/lib/pairOrientation";
import {isListed} from "../src/lib/universe";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {auth: {persistSession: false}},
);

const ORIGINAL_31_HINTS = ["OIIA", "Devil", "FRYGUY", "SPACEHOOD"];

function deepestFor(pairs: DexPair[], address: string, rwaOnly = false): DexPair | null {
  let best: DexPair | null = null;
  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    if (base !== address && quote !== address) continue;
    const other = base === address ? quote : base;
    if (rwaOnly && (!other || !RWA_BY_ADDRESS.has(other))) continue;
    if (!best || (pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)) {
      best = pair;
    }
  }
  return best;
}

function classify(address: string, pair: DexPair) {
  const oriented = usdPriceFor(
    {
      base: pair.baseToken?.address,
      quote: pair.quoteToken?.address,
      priceUsd: pair.priceUsd,
      priceNative: pair.priceNative,
      quotePriceUsd: pair.quotePriceUsd,
    },
    address,
  );
  const raw = Number(pair.priceUsd ?? 0);
  const tokenIsQuote =
    pair.quoteToken?.address?.toLowerCase() === address.toLowerCase();
  const liq = pair.liquidity?.usd ?? 0;
  const price = oriented ?? (tokenIsQuote ? 0 : raw);
  const hidden = price > 0 && looksInvertedMemecoin(price, liq);
  const inverted = tokenIsQuote;
  const renders =
    price > 0 && !hidden && !(inverted && (oriented == null || oriented === raw && raw > 10));
  return {oriented, raw, tokenIsQuote, liq, price, hidden, inverted, renders};
}

async function loadUniverse(): Promise<
  {address: string; symbol: string | null; quote_kind: string | null}[]
> {
  const out: {address: string; symbol: string | null; quote_kind: string | null}[] = [];
  let after = "";
  for (;;) {
    let q = db
      .from("tokens")
      .select("address, symbol, quote_kind, launchpad, reward_rwa, bonded_at, status")
      .eq("status", "listed")
      .not("launchpad", "is", null)
      .or("quote_kind.eq.rwa,reward_rwa.not.is.null")
      .order("address")
      .limit(1000);
    if (after) q = q.gt("address", after);
    const {data, error} = await q;
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (
        !isListed({
          launchpad: row.launchpad,
          quoteKind: row.quote_kind,
          rewardRwa: row.reward_rwa,
          bonded: Boolean(row.bonded_at) || row.launchpad === "long",
        })
      ) {
        continue;
      }
      out.push({
        address: row.address,
        symbol: row.symbol,
        quote_kind: row.quote_kind,
      });
    }
    after = rows[rows.length - 1].address;
    if (rows.length < 1000) break;
  }
  return out;
}

async function geckoPage1Sample(): Promise<
  {address: string; symbol: string; stock: string; tokenIsQuote: boolean}[]
> {
  const found = new Map<
    string,
    {address: string; symbol: string; stock: string; tokenIsQuote: boolean}
  >();
  for (const stock of RWA_REGISTRY) {
    const url = `https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${stock.address}/pools?page=1`;
    try {
      const res = await fetch(url, {headers: {accept: "application/json"}});
      if (!res.ok) continue;
      const body = (await res.json()) as {
        data?: {
          attributes?: {name?: string; address?: string};
          relationships?: {
            base_token?: {data?: {id?: string}};
            quote_token?: {data?: {id?: string}};
          };
        }[];
        included?: {id?: string; attributes?: {address?: string; symbol?: string}}[];
      };
      const included = new Map(
        (body.included ?? []).map((row) => [row.id ?? "", row]),
      );
      for (const pool of body.data ?? []) {
        const baseId = pool.relationships?.base_token?.data?.id;
        const quoteId = pool.relationships?.quote_token?.data?.id;
        const base = included.get(baseId ?? "");
        const quote = included.get(quoteId ?? "");
        const baseAddr = base?.attributes?.address?.toLowerCase();
        const quoteAddr = quote?.attributes?.address?.toLowerCase();
        const stockAddr = stock.address.toLowerCase();
        if (baseAddr === stockAddr && quoteAddr && quoteAddr !== stockAddr) {
          found.set(quoteAddr, {
            address: quoteAddr,
            symbol: quote?.attributes?.symbol ?? "",
            stock: stock.ticker,
            tokenIsQuote: true,
          });
        } else if (quoteAddr === stockAddr && baseAddr && baseAddr !== stockAddr) {
          if (!found.has(baseAddr)) {
            found.set(baseAddr, {
              address: baseAddr,
              symbol: base?.attributes?.symbol ?? "",
              stock: stock.ticker,
              tokenIsQuote: false,
            });
          }
        }
      }
    } catch {
      // next stock
    }
  }
  return [...found.values()];
}

async function main() {
  const universe = await loadUniverse();
  console.log(JSON.stringify({universe: universe.length}));

  const inverted: {
    address: string;
    symbol: string | null;
    price: number;
    liq: number;
    hidden: boolean;
  }[] = [];
  const hidden: typeof inverted = [];
  let withPair = 0;
  let renders = 0;

  for (let i = 0; i < universe.length; i += 30) {
    const slice = universe.slice(i, i + 30);
    const pairs = await pairsForAddresses(slice.map((row) => row.address));
    for (const row of slice) {
      const pair =
        deepestFor(pairs, row.address.toLowerCase(), true) ??
        deepestFor(pairs, row.address.toLowerCase());
      if (!pair) continue;
      withPair += 1;
      const result = classify(row.address, pair);
      if (result.renders) renders += 1;
      if (result.inverted) {
        inverted.push({
          address: row.address,
          symbol: row.symbol,
          price: result.price,
          liq: result.liq,
          hidden: result.hidden,
        });
      }
      if (result.hidden) {
        hidden.push({
          address: row.address,
          symbol: row.symbol,
          price: result.price,
          liq: result.liq,
          hidden: true,
        });
      }
    }
    if (i % 300 === 0) {
      console.log(JSON.stringify({scanned: i + slice.length, withPair, inverted: inverted.length, hidden: hidden.length}));
    }
  }

  const sample = await geckoPage1Sample();
  const samplePairs = await pairsForAddresses(sample.map((row) => row.address));
  const sampleOut = sample.map((row) => {
    const pair = deepestFor(samplePairs, row.address);
    const result = pair ? classify(row.address, pair) : null;
    return {
      ...row,
      renders: Boolean(result?.renders),
      hidden: Boolean(result?.hidden),
      price: result?.price ?? 0,
      oriented: result?.oriented ?? null,
    };
  });

  console.log(
    JSON.stringify(
      {
        done: true,
        universe: universe.length,
        withPair,
        inverted: inverted.length,
        hidden: hidden.length,
        renders,
        hiddenList: hidden,
        geckoPage1: {
          unique: sample.length,
          renderCorrectly: sampleOut.filter((row) => row.renders).length,
          hidden: sampleOut.filter((row) => row.hidden).length,
          stillWrong: sampleOut.filter((row) => !row.renders),
          hints: ORIGINAL_31_HINTS,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

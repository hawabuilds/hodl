import type {SocialLinks, StockType} from "@/lib/types";

/**
 * The static half of the universe: what an asset *is*, as opposed to what it is
 * worth right now. Prices, volumes and charts are derived per request in
 * `market.ts`; nothing in this file moves.
 *
 * Swapping in live data means replacing the adapters in `sources.ts`, not
 * touching this file — it stays useful as the fallback when a feed is down.
 */

export interface RwaSeed {
  ticker: string;
  name: string;
  stockType: StockType;
  /** Reference price the drift walks away from. */
  basePrice: number;
  description: string;
}

/** ticker, name, type, base price, one-line description. */
const RWA_ROWS: [string, string, StockType, number, string][] = [
  ["NVDA", "NVIDIA", "stock", 184.2, "Designs the GPUs that train and serve most large AI models."],
  ["AMD", "Advanced Micro Devices", "stock", 162.4, "CPUs and accelerators competing with Intel and NVIDIA."],
  ["AVGO", "Broadcom", "stock", 341.8, "Networking silicon and custom AI chips for hyperscalers."],
  ["TSM", "Taiwan Semiconductor", "adr", 214.6, "Fabricates the leading-edge chips almost every designer depends on."],
  ["ASML", "ASML Holding", "adr", 872.5, "Sole supplier of the EUV lithography machines advanced chips need."],
  ["MU", "Micron Technology", "stock", 148.9, "Memory and storage, increasingly priced off AI demand."],
  ["INTC", "Intel", "stock", 32.7, "Legacy x86 leader rebuilding around its foundry business."],
  ["QCOM", "Qualcomm", "stock", 168.3, "Mobile modems and chips, expanding into automotive and PCs."],
  ["MRVL", "Marvell Technology", "stock", 92.4, "Custom silicon and optics for data-centre interconnect."],
  ["LRCX", "Lam Research", "stock", 104.1, "Etch and deposition tools used across every modern fab."],
  ["PLTR", "Palantir", "stock", 172.6, "Data and decision software for governments and large enterprises."],
  ["SMCI", "Super Micro Computer", "stock", 44.2, "Builds and ships the server racks AI clusters run on."],
  ["ANET", "Arista Networks", "stock", 138.5, "High-speed switching for cloud and AI back-end networks."],
  ["CRWV", "CoreWeave", "stock", 118.7, "GPU cloud renting compute to AI labs by the hour."],
  ["VRT", "Vertiv", "stock", 141.3, "Power and cooling infrastructure for data centres."],
  ["NBIS", "Nebius Group", "stock", 68.4, "European AI cloud spun out of Yandex."],
  ["MSFT", "Microsoft", "stock", 512.4, "Azure, Office, and the largest commercial stake in OpenAI."],
  ["ORCL", "Oracle", "stock", 244.9, "Databases and a fast-growing AI-focused cloud backlog."],
  ["CRM", "Salesforce", "stock", 262.1, "Customer software layering agents on top of enterprise data."],
  ["SNOW", "Snowflake", "stock", 198.3, "Cloud data warehouse billed on consumption."],
  ["NET", "Cloudflare", "stock", 172.8, "Edge network handling a large share of global web traffic."],
  ["CRWD", "CrowdStrike", "stock", 418.6, "Endpoint security delivered as a single agent."],
  ["ADBE", "Adobe", "stock", 356.2, "Creative and document software adding generative tooling."],
  ["PANW", "Palo Alto Networks", "stock", 189.4, "Network and cloud security consolidating a fragmented market."],
  ["AMZN", "Amazon", "stock", 228.7, "Retail, advertising, and AWS, the largest cloud provider."],
  ["GOOGL", "Alphabet", "stock", 196.5, "Search, YouTube, Cloud, and the Gemini model family."],
  ["META", "Meta Platforms", "stock", 612.3, "Social apps funding open-weight model research at scale."],
  ["NFLX", "Netflix", "stock", 892.1, "Streaming, now with an ad tier and live events."],
  ["SHOP", "Shopify", "stock", 118.2, "Commerce infrastructure for independent merchants."],
  ["RDDT", "Reddit", "stock", 164.8, "Forum network monetising ads and data licensing."],
  ["RKLB", "Rocket Lab", "stock", 42.6, "Small-launch provider moving up to the Neutron rocket."],
  ["ASTS", "AST SpaceMobile", "stock", 38.9, "Building a satellite network that talks to ordinary phones."],
  ["LMT", "Lockheed Martin", "stock", 468.2, "Prime defence contractor behind the F-35 programme."],
  ["BA", "Boeing", "stock", 182.4, "Commercial aircraft and defence, working through a delivery backlog."],
  ["JOBY", "Joby Aviation", "stock", 9.8, "Electric air taxis awaiting full FAA certification."],
  ["LUNR", "Intuitive Machines", "stock", 14.2, "Lunar landers flying NASA payloads under CLPS."],
  ["OKLO", "Oklo", "stock", 68.5, "Small modular fission reactors aimed at data-centre power."],
  ["SMR", "NuScale Power", "stock", 32.8, "The first SMR design cleared by US regulators."],
  ["VST", "Vistra", "stock", 176.4, "Independent power producer with a large nuclear fleet."],
  ["CEG", "Constellation Energy", "stock", 288.6, "Largest US nuclear operator, selling power to hyperscalers."],
  ["GEV", "GE Vernova", "stock", 412.7, "Turbines, grid equipment and wind, spun out of GE."],
  ["NNE", "Nano Nuclear Energy", "stock", 28.4, "Early-stage microreactor developer."],
  ["COIN", "Coinbase", "stock", 312.5, "The largest US-listed crypto exchange and custodian."],
  ["MSTR", "Strategy", "stock", 342.8, "Software company operating as a leveraged bitcoin holding vehicle."],
  ["CRCL", "Circle Internet Group", "stock", 148.6, "Issuer of USDC, earning on the reserves behind it."],
  ["GLXY", "Galaxy Digital", "stock", 28.9, "Crypto trading, asset management and data-centre buildout."],
  ["IREN", "IREN", "stock", 42.3, "Bitcoin miner converting sites to AI compute."],
  ["IONQ", "IonQ", "stock", 48.7, "Trapped-ion quantum computers sold through the clouds."],
  ["QBTS", "D-Wave Quantum", "stock", 18.4, "Quantum annealing aimed at optimisation problems."],
  ["RGTI", "Rigetti Computing", "stock", 22.6, "Superconducting qubit systems and a fabrication line."],
  ["LLY", "Eli Lilly", "stock", 892.4, "GLP-1 leader in obesity and diabetes treatment."],
  ["UNH", "UnitedHealth", "stock", 342.1, "Largest US health insurer, paired with Optum services."],
  ["HIMS", "Hims and Hers Health", "stock", 42.8, "Direct-to-consumer telehealth and compounded prescriptions."],
  ["MRNA", "Moderna", "stock", 28.6, "mRNA platform beyond its COVID vaccine franchise."],
  ["AAPL", "Apple", "stock", 268.4, "iPhone, services, and silicon designed in-house."],
  ["TSLA", "Tesla", "stock", 412.6, "Electric vehicles, energy storage, and an autonomy bet."],
  ["COST", "Costco Wholesale", "stock", 942.3, "Membership warehouse retail with unusually durable pricing."],
  ["LULU", "Lululemon", "stock", 328.7, "Athletic apparel navigating a slower North America."],
  ["CVNA", "Carvana", "stock", 268.4, "Online used-car retailer after a debt restructuring."],
  ["SOFI", "SoFi Technologies", "stock", 22.8, "Digital bank bundling lending, investing and payments."],
  ["NU", "Nu Holdings", "stock", 14.6, "Latin American digital bank with a very large deposit base."],
  ["FUTU", "Futu Holdings", "adr", 118.4, "Online brokerage serving Hong Kong and mainland investors."],
  ["SPY", "SPDR S&P 500 ETF", "etf", 682.4, "Tracks the S&P 500 — the default US equity exposure."],
  ["QQQ", "Invesco QQQ Trust", "etf", 592.8, "Tracks the Nasdaq-100, heavily weighted to large-cap tech."],
  ["GLD", "SPDR Gold Shares", "etf", 318.6, "Holds allocated physical gold in London vaults."],
  ["SLV", "iShares Silver Trust", "etf", 42.9, "Holds physical silver; more industrial than gold."],
  ["SMH", "VanEck Semiconductor ETF", "etf", 312.4, "Concentrated basket of the largest chip names."],
  ["VTI", "Vanguard Total Stock Market", "etf", 322.8, "The whole investable US market in one fund."],
];

export const RWA_SEEDS: RwaSeed[] = RWA_ROWS.map(
  ([ticker, name, stockType, basePrice, description]) => ({
    ticker,
    name,
    stockType,
    basePrice,
    description,
  }),
);

export interface TokenSeed {
  symbol: string;
  name: string;
  /** RWA on the other side of the pool. */
  pairedTicker: string;
  description: string;
  socials: SocialLinks;
}

/** symbol, name, paired RWA, description. */
const TOKEN_ROWS: [string, string, string, string][] = [
  ["GPUCOIN", "GPU Coin", "NVDA", "Community token for people who think compute is the only real asset."],
  ["JENSEN", "Jensen", "NVDA", "Leather-jacket maximalism, pooled against NVDA."],
  ["WAFER", "Wafer", "TSM", "A fab-cycle token paired to the foundry everyone depends on."],
  ["EUV", "EUV", "ASML", "Lithography bulls, one machine at a time."],
  ["SILICON", "Silicon", "AMD", "Underdog chip token pooled against AMD."],
  ["DRAM", "DRAM", "MU", "A memory-cycle token that only trades when prices move."],
  ["GOTHAM", "Gotham", "PLTR", "Named for the platform, pooled against the ticker."],
  ["RACKS", "Racks", "SMCI", "For people who count server racks instead of revenue."],
  ["FLOPS", "Flops", "CRWV", "Rent-per-GPU-hour culture, tokenized."],
  ["COOLANT", "Coolant", "VRT", "Thermals are the bottleneck. This is that trade."],
  ["AZURE", "Azure", "MSFT", "Cloud-share token pooled against Microsoft."],
  ["LARRY", "Larry", "ORCL", "Late-cycle cloud believers, pooled against Oracle."],
  ["FLAKE", "Flake", "SNOW", "Consumption-billing token for warehouse maximalists."],
  ["ORANGE", "Orange", "NET", "Edge-network token with an orange problem."],
  ["PRIME", "Prime", "AMZN", "Two-day delivery as an ideology."],
  ["GEMINI", "Gemini", "GOOGL", "Model-race token pooled against Alphabet."],
  ["ZUCK", "Zuck", "META", "Open weights, closed feed, pooled against META."],
  ["BINGE", "Binge", "NFLX", "Subscriber-count token for the streaming endgame."],
  ["KARMA", "Karma", "RDDT", "The only token whose community is also its product."],
  ["NEUTRON", "Neutron", "RKLB", "Launch-cadence token pooled against Rocket Lab."],
  ["BARS", "Bars", "ASTS", "Signal everywhere, eventually."],
  ["FISSION", "Fission", "OKLO", "Small reactors, large convictions."],
  ["MODULE", "Module", "SMR", "An SMR-cycle token paired against NuScale."],
  ["BASELOAD", "Baseload", "CEG", "Nuclear power for data centres, tokenized."],
  ["TURBINE", "Turbine", "GEV", "Grid-buildout token pooled against GE Vernova."],
  ["SATS", "Sats", "COIN", "Exchange-volume token for the cycle."],
  ["ORANGEPILL", "Orangepill", "MSTR", "Leveraged conviction, once removed."],
  ["PEGGED", "Pegged", "CRCL", "Stablecoin reserve income as a meme."],
  ["QUBIT", "Qubit", "IONQ", "Decoherence is temporary, the pool is forever."],
  ["ANNEAL", "Anneal", "QBTS", "Optimisation-problem token paired to D-Wave."],
  ["GLP", "GLP", "LLY", "The appetite-suppression trade, pooled against Lilly."],
  ["SCRIPT", "Script", "HIMS", "Telehealth-volume token."],
  ["CUPERTINO", "Cupertino", "AAPL", "The most patient token in the pool."],
  ["FSD", "FSD", "TSLA", "An autonomy timeline as a tradeable asset."],
  ["BULK", "Bulk", "COST", "Membership-renewal maximalism."],
  ["SPYDER", "Spyder", "SPY", "Index beta with extra steps."],
  ["BULLION", "Bullion", "GLD", "Vaulted gold, unvaulted opinions."],
  ["FOUNDRY", "Foundry", "SMH", "The whole chip basket, in one pool."],
];

export const TOKEN_SEEDS: TokenSeed[] = TOKEN_ROWS.map(
  ([symbol, name, pairedTicker, description]) => ({
    symbol,
    name,
    pairedTicker,
    description,
    socials: {
      x: `https://x.com/${symbol.toLowerCase()}`,
      telegram: `https://t.me/${symbol.toLowerCase()}`,
      website: `https://${symbol.toLowerCase()}.example`,
      discord: null,
    },
  }),
);

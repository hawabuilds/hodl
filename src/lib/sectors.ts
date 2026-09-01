/**
 * Industry sectors for the tokenized RWA universe.
 *
 * Robinhood's `/rhj/assets` registry carries no sector field, so the mapping
 * lives here. The buckets are deliberately not GICS: this universe is ~70%
 * technology, and a single "Technology" chip holding 130 tickers would be
 * useless to filter by. They follow the themes players actually trade instead.
 *
 * A ticker the registry adds before this map catches up simply has no sector.
 * It stays searchable and stays on the All chip, which is why nothing here
 * needs a catch-all bucket.
 */

export type SectorId =
  | "semis"
  | "ai"
  | "software"
  | "internet"
  | "space"
  | "energy"
  | "crypto"
  | "quantum"
  | "health"
  | "consumer"
  | "finance"
  | "funds";

export interface Sector {
  id: SectorId;
  label: string;
  /** Longer form for the detail sheet tag's tooltip and screen readers. */
  description: string;
}

/** Rail order. Curated rather than sorted by size so chip positions stay learnable. */
export const SECTORS: Sector[] = [
  {id: "semis", label: "Semiconductors", description: "Chips, equipment & photonics"},
  {id: "ai", label: "AI & Data", description: "AI compute, cloud & data centers"},
  {id: "software", label: "Software", description: "Enterprise & consumer software"},
  {id: "internet", label: "Internet & Media", description: "Platforms, social & entertainment"},
  {id: "space", label: "Space & Defense", description: "Aerospace, defense & satellites"},
  {id: "energy", label: "Energy", description: "Power, nuclear & materials"},
  {id: "crypto", label: "Crypto", description: "Digital assets & mining"},
  {id: "quantum", label: "Quantum", description: "Quantum computing"},
  {id: "health", label: "Healthcare", description: "Pharma, biotech & care"},
  {id: "consumer", label: "Consumer", description: "Retail, autos & leisure"},
  {id: "finance", label: "Finance", description: "Banks, brokers & fintech"},
  {id: "funds", label: "Funds & ETFs", description: "Index, bond & commodity funds"},
];

const MEMBERS: Record<SectorId, string[]> = {
  semis: [
    "AAOI", "AEHR", "AEIS", "ALAB", "AMAT", "AMBA", "AMD", "AMKR", "ASML",
    "AVGO", "AXTI", "CIEN", "COHR", "CRDO", "GLW", "INTC", "KLAC", "LITE",
    "LRCX", "MPWR", "MRVL", "MTSI", "MU", "MXL", "NVDA", "NVTS", "ON", "ONTO",
    "POET", "QCOM", "SIMO", "SKHY", "SNDK", "TER", "TSEM", "TSM", "UMC",
    "VICR", "WDC",
  ],
  ai: [
    "ANET", "APLD", "AUR", "CBRS", "CLS", "CRWV", "CSCO", "DELL", "DOCN",
    "FIX", "HPE", "INOD", "JBL", "MOD", "NBIS", "OUST", "PATH", "PLTR",
    "POWL", "PWR", "SMCI", "SOUN", "VRT", "WYFI", "PENG",
  ],
  software: [
    "ADBE", "APP", "BB", "CRM", "CRWD", "CTSH", "DDOG", "FICO", "FIG", "FTNT",
    "IBM", "INTU", "MDB", "MSFT", "NAVN", "NET", "NOW", "ORCL", "PANW",
    "SNOW", "TEAM", "WDAY", "ZM", "ZS",
  ],
  internet: [
    "AMZN", "BABA", "DJT", "GOOGL", "META", "NFLX", "RBLX", "RDDT", "SHOP",
    "SNAP", "TTD", "TTWO",
  ],
  space: [
    "ASTS", "AVAV", "AXON", "BA", "FLY", "GE", "HII", "HWM", "JOBY", "KTOS",
    "LHX", "LMT", "LUNR", "PL", "RCAT", "RDW", "RKLB", "SATS", "SPCX", "VSAT",
  ],
  energy: [
    "BE", "CEG", "FLNC", "GEV", "NNE", "OKLO", "PR", "RUN", "SMR", "TE",
    "USAR", "VST", "XOM",
  ],
  crypto: ["BULL", "CLSK", "COIN", "CRCL", "GLXY", "IREN", "MSTR", "WULF"],
  quantum: ["INFQ", "IONQ", "QBTS", "QUBT", "RGTI", "XNDU"],
  health: [
    "ABCL", "CLOV", "HIMS", "IBRX", "JNJ", "LLY", "MRNA", "PFE", "SLS", "TEM",
    "UNH",
  ],
  consumer: [
    "AAPL", "AMC", "CCL", "CELH", "COST", "CVNA", "ELF", "F", "GME", "KSS",
    "LULU", "P", "RIVN", "TSLA", "UPS",
  ],
  finance: ["FISV", "FUTU", "NU", "SOFI"],
  funds: [
    "BND", "EWT", "EWY", "GLD", "INDA", "QQQ", "SCHD", "SGOV", "SHY", "SLV",
    "SMH", "SOXX", "SPMO", "SPY", "USO", "VTI", "XLK",
  ],
};

const BY_TICKER = new Map<string, Sector>(
  SECTORS.flatMap((sector) =>
    MEMBERS[sector.id].map((ticker) => [ticker, sector] as const),
  ),
);

export function sectorFor(ticker: string): Sector | null {
  return BY_TICKER.get(ticker.toUpperCase()) ?? null;
}

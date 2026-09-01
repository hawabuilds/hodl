import {json} from "@/lib/server/http";
import {fetchEthPrice} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/** ETH in dollars, so the order sheet can price a trade in either. */
export async function GET() {
  const {data, seeded} = await fetchEthPrice();
  return json({usd: data, seeded});
}

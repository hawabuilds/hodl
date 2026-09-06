import {AssetPage} from "@/components/AssetPage";

export default function TokenChartPage({
  params,
  searchParams,
}: {
  params: {id: string};
  searchParams: {tf?: string | string[]};
}) {
  const raw = searchParams.tf;
  const requestedTimeframe = Array.isArray(raw) ? raw[0] : raw;
  return (
    <AssetPage
      kind="token"
      id={params.id}
      requestedTimeframe={requestedTimeframe}
    />
  );
}

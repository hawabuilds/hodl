import {AssetPage} from "@/components/AssetPage";

export default async function RwaChartPage(props: {
  params: Promise<{id: string}>;
  searchParams: Promise<{tf?: string | string[]}>;
}) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const raw = searchParams.tf;
  const requestedTimeframe = Array.isArray(raw) ? raw[0] : raw;
  return (
    <AssetPage
      kind="rwa"
      id={params.id}
      requestedTimeframe={requestedTimeframe}
    />
  );
}

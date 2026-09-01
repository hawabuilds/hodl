import {AssetPage} from "@/components/AssetPage";

export default function TokenChartPage({params}: {params: {id: string}}) {
  return <AssetPage kind="token" id={params.id} />;
}

import {AssetPage} from "@/components/AssetPage";

export default function RwaChartPage({params}: {params: {id: string}}) {
  return <AssetPage kind="rwa" id={params.id} />;
}

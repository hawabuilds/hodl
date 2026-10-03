import {SurfaceScreenMocks} from "./_components/SurfaceScreenMocks";

export default async function SurfaceScreensPage(props: {searchParams: Promise<{shot?: string}>}) {
  const searchParams = await props.searchParams;
  const shot = searchParams.shot ?? "edit-profile";
  return <SurfaceScreenMocks shot={shot} />;
}

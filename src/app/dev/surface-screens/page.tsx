import {SurfaceScreenMocks} from "./_components/SurfaceScreenMocks";

export default function SurfaceScreensPage({
  searchParams,
}: {
  searchParams: {shot?: string};
}) {
  const shot = searchParams.shot ?? "edit-profile";
  return <SurfaceScreenMocks shot={shot} />;
}

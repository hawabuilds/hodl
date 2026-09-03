import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {hasDatabase} from "@/lib/server/db";
import {profilesByHandles} from "@/lib/server/social-live";
import {getProfile} from "@/lib/server/social";
import type {Profile} from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_HANDLES = 60;

/** Resolves a list of handles to profiles, for follower and following lists. */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("handles") ?? "";
  const handles = raw
    .split(",")
    .map((handle) => handle.trim().replace(/^@/, ""))
    .filter(Boolean);

  if (handles.length === 0) return json({people: []});
  if (handles.length > MAX_HANDLES) {
    return badRequest(`At most ${MAX_HANDLES} handles.`);
  }

  // With a database configured, absence is the answer. Falling through to the
  // seeded cast here would hand back a persona whenever a real handle happened
  // to match one, which is a fabricated person on a follower list.
  if (hasDatabase) {
    return json({people: await profilesByHandles(handles), seeded: false});
  }

  const people = handles
    .map((handle) => getProfile(handle))
    .filter((profile): profile is Profile => profile !== null);

  return json({people, seeded: true});
}

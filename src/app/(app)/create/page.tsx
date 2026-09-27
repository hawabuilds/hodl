import {redirect} from "next/navigation";

/**
 * Launching is a pop-up over the feed, not a page. This route stays so any
 * link to `/create` — a share, a bookmark — still opens it.
 */
export default function CreatePage() {
  redirect("/home?create=1");
}

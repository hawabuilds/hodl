import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";

export function AssetSkeleton() {
  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <div className="h-9 w-9 animate-pulse rounded-full bg-wash" />
      <div className="mt-3 flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-full bg-wash" />
        <div className="flex-1">
          <div className="h-4 w-24 animate-pulse rounded bg-wash" />
          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-wash" />
        </div>
      </div>
      <div className="mt-6 h-9 w-40 animate-pulse rounded bg-wash" />
      <div className="mt-4 h-[190px] animate-pulse rounded-panel bg-wash" />
      <div className="mt-4 h-8 animate-pulse rounded-control bg-wash" />
    </div>
  );
}

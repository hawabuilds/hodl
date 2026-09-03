"use client";

import Link from "next/link";
import type {ReactNode} from "react";
import {usePrefetchAsset} from "@/hooks/usePrefetchAsset";
import {assetPath} from "@/lib/routes";
import type {AssetKind} from "@/lib/types";

/**
 * A link to a chart page that warms the bundle before navigation.
 *
 * Every surface that opens an asset should use this rather than a bare Link,
 * so holdings, news chips and pair badges load as quickly as feed rows.
 */
export function AssetLink({
  kind,
  id,
  className,
  children,
  title,
}: {
  kind: AssetKind;
  id: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const prefetch = usePrefetchAsset();
  const warm = () => prefetch(kind, id);

  return (
    <Link
      href={assetPath(kind, id)}
      prefetch
      className={className}
      title={title}
      onPointerDown={warm}
      onMouseEnter={warm}
    >
      {children}
    </Link>
  );
}

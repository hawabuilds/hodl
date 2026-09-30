"use client";

import {useEffect, useState, type ImgHTMLAttributes} from "react";

import {newsThumbUrl, type NewsThumbWidth} from "@/lib/newsThumb";

/**
 * A news picture at the size it is shown: our stored WebP copy first, the
 * publisher's original if no copy exists yet, nothing if both fail.
 */
export function NewsImage({
  src,
  width,
  onFail,
  ...img
}: {
  src: string | null | undefined;
  /** 240 for thumbnails, 720 for lead pictures and cards. */
  width: NewsThumbWidth;
  onFail?: () => void;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width">) {
  const thumb = newsThumbUrl(src, width);
  const [stage, setStage] = useState<"thumb" | "original" | "failed">(thumb ? "thumb" : "original");

  useEffect(() => {
    setStage(newsThumbUrl(src, width) ? "thumb" : "original");
  }, [src, width]);

  if (!src || stage === "failed") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- publisher artwork from any host; our copy is already sized
    <img
      alt=""
      {...img}
      src={stage === "thumb" && thumb ? thumb : src}
      onError={() => {
        if (stage === "thumb") {
          setStage("original");
        } else {
          setStage("failed");
          onFail?.();
        }
      }}
    />
  );
}

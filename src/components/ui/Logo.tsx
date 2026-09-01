import {APP_NAME} from "@/config/app";
import {cn} from "@/lib/cn";
import {ArrowUpRightIcon} from "./Icons";

interface LogoProps {
  size?: "sm" | "md";
  tone?: "ink" | "white";
  className?: string;
}

export function Logo({size = "md", tone = "ink", className}: LogoProps) {
  const small = size === "sm";
  return (
    <div
      className={cn(
        "flex items-center gap-[9px] font-extrabold tracking-[-0.03em]",
        small ? "text-[19px]" : "text-[21px]",
        tone === "white" ? "text-white" : "text-ink",
        className,
      )}
    >
      <span
        className={cn(
          "grid place-items-center rounded-[10px] bg-green",
          small ? "h-7 w-7" : "h-[31px] w-[31px]",
          tone === "ink" && "shadow-[0_8px_18px_-8px_rgba(0,200,5,0.75)]",
        )}
      >
        <ArrowUpRightIcon
          className={cn("text-white", small ? "h-[15px] w-[15px]" : "h-[17px] w-[17px]")}
        />
      </span>
      {APP_NAME}
    </div>
  );
}

import type {SVGProps} from "react";
import {cn} from "@/lib/cn";
import type {SocialLinks} from "@/lib/types";
import {DiscordIcon, GlobeIcon, TelegramIcon, XIcon} from "./ui/Icons";

const ORDER: {
  key: keyof SocialLinks;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
}[] = [
  {key: "x", label: "X", Icon: XIcon},
  {key: "telegram", label: "Telegram", Icon: TelegramIcon},
  {key: "discord", label: "Discord", Icon: DiscordIcon},
  {key: "website", label: "Website", Icon: GlobeIcon},
];

/** Renders only the links a project actually has; an empty set renders nothing. */
export function SocialRow({
  socials,
  className,
  size = 15,
}: {
  socials: SocialLinks;
  className?: string;
  size?: number;
}) {
  const links = ORDER.filter((entry) => socials[entry.key]);
  if (links.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {links.map(({key, label, Icon}) => (
        <a
          key={key}
          href={socials[key] as string}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
        >
          {/* Sized inline: Tailwind cannot build a class from a runtime value. */}
          <Icon style={{width: size, height: size}} />
        </a>
      ))}
    </div>
  );
}

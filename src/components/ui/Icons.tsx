import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Sliders, not a funnel.
 *
 * The feed's filters are ranges rather than a set of things to include, and a
 * funnel reads as "narrow this list" where sliders read as "set the bounds" —
 * which is what the sheet behind it actually offers.
 */
export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...stroke} />
      <circle cx="16" cy="7" r="2.2" {...stroke} />
      <circle cx="10" cy="17" r="2.2" {...stroke} />
    </Icon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20L20 4M20 4h-7M20 4v7" {...stroke} strokeWidth={2.4} />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={2} />
      <path d="M21 21l-4-4" {...stroke} />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6L9 17l-5-5" {...stroke} strokeWidth={2.8} />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" {...stroke} />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke} />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v11M8 7l4-4 4 4" {...stroke} strokeWidth={2} />
      <path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={2} />
    </Icon>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" {...stroke} />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M16 17l5-5-5-5M21 12H9M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6"
        {...stroke}
      />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M3 9a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM3 9V7a2 2 0 012-2h11M17 13.5h.01"
        {...stroke}
      />
    </Icon>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M8 21h8M12 17.5V21M6 4h12v3.5a6 6 0 01-12 0V4zM6 6.5H4V8a3 3 0 002.5 2.95M18 6.5h2V8a3 3 0 01-2.5 2.95"
        {...stroke}
        strokeWidth={1.9}
      />
    </Icon>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M20 12v8H4v-8M2.5 8h19v4h-19zM12 20V8M12 8H8.2A2.1 2.1 0 019.6 4.3C11 4.3 12 6 12 8zM12 8h3.8A2.1 2.1 0 0014.4 4.3C13 4.3 12 6 12 8z"
        {...stroke}
        strokeWidth={1.8}
      />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth={2} />
      <path
        d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        {...stroke}
        strokeWidth={2}
      />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M20 14.5A8.5 8.5 0 0111.5 6 8.5 8.5 0 1012 21a8.4 8.4 0 006-6.5z"
        {...stroke}
        strokeWidth={2}
      />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 16.5V9M7.5 9L5.5 11M7.5 9L9.5 11" {...stroke} strokeWidth={2.2} />
      <path d="M16.5 7.5V15M16.5 15L14.5 13M16.5 15L18.5 13" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={2} />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Icon>
  );
}

export function BarsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 20V11M12 20V4M17 20v-6" {...stroke} />
    </Icon>
  );
}

export function CapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M3 7l9-4 9 4-9 4-9-4zM7 10v5c0 1 2 2.5 5 2.5S17 16 17 15v-5"
        {...stroke}
        strokeWidth={1.9}
      />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16v12H4zM4 7l8 6 8-6" {...stroke} />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
      <path d="M12 7.5V12l3 2" {...stroke} />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth={2} />
      <path d="M8 10V7a4 4 0 018 0v3" {...stroke} />
    </Icon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2zm-2.4 18h1.9L7.5 4H5.5l11 16z" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5z" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M12 3.6l2.6 5.3 5.9.85-4.25 4.14 1 5.86L12 17l-5.25 2.75 1-5.86L3.5 9.75l5.9-.85L12 3.6z"
        {...stroke}
        strokeWidth={1.9}
      />
    </Icon>
  );
}

export function StarFilledIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M12 3.6l2.6 5.3 5.9.85-4.25 4.14 1 5.86L12 17l-5.25 2.75 1-5.86L3.5 9.75l5.9-.85L12 3.6z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function VerifiedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M12 2.6l2.35 1.72 2.9-.14.9 2.77 2.35 1.72-1.1 2.7 1.1 2.7-2.35 1.72-.9 2.77-2.9-.14L12 21.4l-2.35-1.72-2.9.14-.9-2.77L3.5 15.33l1.1-2.7-1.1-2.7 2.35-1.72.9-2.77 2.9.14L12 2.6z"
        fill="currentColor"
      />
      <path d="M8.6 12.2l2.3 2.3 4.5-4.6" stroke="var(--card)" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth={1.9} />
      <path
        d="M19.4 14.4a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.96 1.46v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.46-.97h-.17a1.9 1.9 0 0 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.03 1.6 1.6 0 0 0-.32-1.78l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32h.08A1.6 1.6 0 0 0 10.6 3.2v-.17a1.9 1.9 0 0 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.46.96h.17a1.9 1.9 0 0 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97z"
        {...stroke}
        strokeWidth={1.6}
      />
    </Icon>
  );
}

export function TelegramIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M21 4.5L2.9 11.4c-.9.34-.88 1.62.03 1.93l4.4 1.5 1.7 5.1c.26.78 1.27.96 1.79.33l2.36-2.87 4.42 3.25c.63.46 1.53.12 1.7-.65L22.4 5.6c.17-.8-.63-1.42-1.4-1.1z"
        {...stroke}
        strokeWidth={1.8}
      />
      <path d="M7.33 14.83L18.4 7.2l-7.7 8.36-.3 3.9" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth={1.9} />
      <path d="M3.4 12h17.2M12 3.4c2.2 2.4 3.3 5.4 3.3 8.6s-1.1 6.2-3.3 8.6c-2.2-2.4-3.3-5.4-3.3-8.6S9.8 5.8 12 3.4z" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}

export function DiscordIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M8.6 5.4A14 14 0 0 1 12 5c1.2 0 2.3.14 3.4.4L16.2 4c1.7.3 3.3.9 4.7 1.8 1.6 3 2.4 6.4 2.2 10a15 15 0 0 1-4.6 2.4l-1-1.7c.6-.24 1.2-.54 1.7-.9M8.6 5.4L7.8 4c-1.7.3-3.3.9-4.7 1.8-1.6 3-2.4 6.4-2.2 10a15 15 0 0 0 4.6 2.4l1-1.7c-.6-.24-1.2-.54-1.7-.9"
        {...stroke}
        strokeWidth={1.6}
      />
      <circle cx="9" cy="12.5" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1.5" fill="currentColor" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.4" stroke="currentColor" strokeWidth={1.9} />
      <path d="M3 20a6 6 0 0 1 12 0M16.5 5.2a3.4 3.4 0 0 1 0 6.6M18 14.4A6 6 0 0 1 21.5 20" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4z" {...stroke} strokeWidth={1.9} />
      <path d="M13.5 6.5l4 4" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 9l7 7 7-7" {...stroke} strokeWidth={2.2} />
    </Icon>
  );
}

export function RocketIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M12 2.6c3.2 2 5 5.6 5 9.6l-2.4 2.8H9.4L7 12.2c0-4 1.8-7.6 5-9.6zM7 12.2L4.4 14v3.4l2.8-1.5M17 12.2l2.6 1.8v3.4l-2.8-1.5M10 20.4c1 1 3 1 4 0"
        {...stroke}
        strokeWidth={1.8}
      />
      <circle cx="12" cy="9.4" r="1.7" stroke="currentColor" strokeWidth={1.8} />
    </Icon>
  );
}

export function DropIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.4s5.6 5.6 5.6 9.4a5.6 5.6 0 1 1-11.2 0C6.4 9 12 3.4 12 3.4z" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth={1.9} />
      <path d="M12 11v5.2M12 7.9h.01" {...stroke} strokeWidth={2.1} />
    </Icon>
  );
}

export function NewsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h11a1 1 0 0 1 1 1V19H5.5A1.5 1.5 0 0 1 4 17.5v-12z" {...stroke} strokeWidth={1.8} />
      <path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5v7A1.5 1.5 0 0 1 18.5 19H16M7 9h6M7 12.5h6M7 16h3.5" {...stroke} strokeWidth={1.8} />
    </Icon>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" {...stroke} strokeWidth={2} />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.8" stroke="currentColor" strokeWidth={1.9} />
      <path d="M4.5 20.2a7.5 7.5 0 0 1 15 0" {...stroke} strokeWidth={1.9} />
    </Icon>
  );
}

export function SortIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M7 12h10M10 17h4" {...stroke} strokeWidth={2} />
    </Icon>
  );
}

export function LineChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 16l4.5-5 3.5 3 5-7 3 4" {...stroke} strokeWidth={2} />
    </Icon>
  );
}

export function CandleChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5v3M8 16v3M16 4v4M16 15v5" {...stroke} strokeWidth={1.8} />
      <rect x="6" y="8" width="4" height="8" rx="0.6" stroke="currentColor" strokeWidth={1.8} />
      <rect x="14" y="8" width="4" height="7" rx="0.6" stroke="currentColor" strokeWidth={1.8} />
    </Icon>
  );
}

export function AppleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M16.2 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.15-2.8.85-3.5.85-.7 0-1.85-.83-3.05-.8-1.55.02-3 .9-3.8 2.3-1.62 2.82-.41 7 1.17 9.28.77 1.12 1.7 2.37 2.9 2.33 1.16-.05 1.6-.75 3-.75s1.8.75 3.03.72c1.25-.02 2.04-1.14 2.8-2.26.88-1.3 1.25-2.55 1.27-2.62-.03-.01-2.43-.93-2.42-3.72zM14 5.9c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.68-1.1 1.76-.96 2.8 1.01.08 2.05-.51 2.69-1.27z"
        fill="currentColor"
      />
    </Icon>
  );
}

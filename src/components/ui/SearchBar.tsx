"use client";

import { cn } from "@/lib/cn";
import { SearchIcon } from "./Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search",
  className,
  label,
}: SearchBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-2xl bg-[var(--bg-input)] px-[15px] py-[13px] shadow-inset-soft",
        "transition-[box-shadow] duration-200 focus-within:shadow-inset-focus",
        className,
      )}
    >
      <SearchIcon className="h-[17px] w-[17px] shrink-0 text-faint" />
      <input
        type="search"
        value={value}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] font-medium text-ink outline-none placeholder:font-medium placeholder:text-faint focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}

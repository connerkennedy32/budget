"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    label: "Take-Home Pay",
    shortLabel: "Pay",
    href: "/take-home",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M12 9v6M9 12h6" />
      </svg>
    ),
  },
  {
    label: "Savings",
    shortLabel: "Savings",
    href: "/savings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    label: "Mortgage",
    shortLabel: "Mortgage",
    href: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    label: "Budget",
    shortLabel: "Budget",
    href: "/budget",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16M4 12h16M4 17h10" />
        <circle cx="19" cy="17" r="2" />
      </svg>
    ),
  },
  {
    label: "Affordability",
    shortLabel: "Afford",
    href: "/affordability",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 7h6l3 10H6L9 7z" />
        <path d="M12 17v4M8 21h8" />
        <circle cx="12" cy="4" r="1.5" />
      </svg>
    ),
  },
];

export function TabNav() {
  const pathname = usePathname();
  return (
      <nav className="ldg-tabnav">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`ldg-tab${active ? " ldg-tab-active" : ""}`}
            >
              <span className="ldg-tab-icon">{tab.icon}</span>
              <span className="ldg-tab-full">{tab.label}</span>
              <span className="ldg-tab-short">{tab.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
  );
}

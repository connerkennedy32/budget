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
    <>
      <style>{`
        /* ── Desktop: top bar ── */
        .ldg-tabnav {
          background: #0A0806;
          border-bottom: 1px solid #28200F;
          display: flex;
          padding: env(safe-area-inset-top, 0) 1rem 0;
          position: relative;
          z-index: 10;
          flex-shrink: 0;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .ldg-tabnav::-webkit-scrollbar { display: none; }
        .ldg-tabnav::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: repeating-linear-gradient(0deg, transparent, transparent 47px, rgba(200,149,42,0.03) 47px, rgba(200,149,42,0.03) 48px);
          pointer-events: none;
        }
        .ldg-tab {
          font-family: 'Figtree', sans-serif;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 0.85rem 0.9rem;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          text-decoration: none;
          color: #6B5C45;
          transition: color 0.15s, border-color 0.15s;
          position: relative;
          z-index: 1;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ldg-tab:hover { color: #F0E8D8; }
        .ldg-tab-active { color: #C8952A; border-bottom-color: #C8952A; }

        .ldg-tab-icon { display: none; }
        .ldg-tab .ldg-tab-short { display: none; }
        .ldg-tab .ldg-tab-full { display: inline; }

        /* ── Mobile: bottom bar ── */
        @media (max-width: 640px) {
          .ldg-tabnav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            top: auto;
            border-bottom: none;
            border-top: 1px solid #28200F;
            padding: 0 0 env(safe-area-inset-bottom, 0);
            justify-content: space-around;
            overflow-x: visible;
          }
          .ldg-tabnav::after { display: none; }
          .ldg-tab {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.2rem;
            padding: 0.5rem 0.25rem 0.35rem;
            border-bottom: none;
            margin-bottom: 0;
            font-size: 0.6rem;
            letter-spacing: 0.06em;
            flex: 1;
            min-width: 0;
          }
          .ldg-tab-active {
            border-bottom: none;
            color: #C8952A;
          }
          .ldg-tab-icon { display: block; }
          .ldg-tab .ldg-tab-full { display: none; }
          .ldg-tab .ldg-tab-short { display: inline; }
        }
      `}</style>
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
    </>
  );
}

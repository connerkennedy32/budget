"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Mortgage", href: "/" },
  { label: "Take-Home Pay", href: "/take-home" },
  { label: "Budget", href: "/budget" },
  { label: "Savings", href: "/savings" },
  { label: "Affordability", href: "/affordability" },
];

export function TabNav() {
  const pathname = usePathname();
  return (
    <>
      <style>{`
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
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

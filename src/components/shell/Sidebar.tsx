"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup } from "./nav";

function isActive(pathname: string, href: string, roleHome: string): boolean {
  if (href === roleHome) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Navy sidebar on wide screens; a top bar with a menu button on phones. */
export function Sidebar({
  groups,
  roleHome,
  userName,
  roleLabel,
  signOut,
}: {
  groups: NavGroup[];
  roleHome: string;
  userName: string;
  roleLabel: string;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between bg-navy px-4 py-3 text-white md:hidden">
        <span className="font-bold">
          Star <span className="text-gold">Generation</span>
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Toggle menu"
          className="rounded-card border border-white/30 px-3 py-1 text-sm"
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>
      </div>

      <aside className={`${open ? "flex" : "hidden"} w-full shrink-0 flex-col bg-navy text-white md:flex md:min-h-screen md:w-64`}>
        <div className="hidden px-5 py-5 text-lg font-bold md:block">
          Star <span className="text-gold">Generation</span>
        </div>
        <nav className="px-3 pb-4 md:pb-0">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">{group.label}</div>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, roleHome);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`mb-0.5 block rounded-card px-3 py-2 text-sm ${
                      active ? "bg-gold font-bold text-navy" : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/15 px-5 py-4 text-sm">
          <div className="font-semibold">{userName}</div>
          <div className="text-xs text-white/60">{roleLabel}</div>
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-xs font-semibold text-gold underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

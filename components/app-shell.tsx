"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Players (/players) and Settings (/settings) removed pending global page decisions.
// Per-tournament Players/Settings tabs live under /t/[id] — not top-nav destinations.
const NAV_ITEMS = [{ href: "/dashboard", label: "Events" }] as const;

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._\-]+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }

  return local.slice(0, 2).toUpperCase() || "?";
}

export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = initialsFromEmail(email);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="flex h-14 items-center gap-6 px-4 sm:px-6"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <Link
          href="/dashboard"
          className="shrink-0 border-2 border-solid px-2.5 py-1"
          style={{
            borderColor: "#f97316",
            clipPath: LOGO_CLIP,
          }}
        >
          <span className="text-sm font-bold tracking-wide text-white">
            CLASH QUEUE
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-5 sm:gap-6">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium transition-colors"
                style={{
                  color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
                }}
              >
                {item.label}
              </Link>
            );
          })}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-xs font-semibold outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring/50"
              )}
              style={{
                background: "rgba(167,139,250,0.15)",
                color: "#c4b5fd",
              }}
              aria-label="Account menu"
            >
              {initials}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem disabled className="truncate opacity-70">
                {email}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6">
        {children}
      </div>
    </div>
  );
}

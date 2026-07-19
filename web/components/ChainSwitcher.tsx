"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Pills for switching the page between configured chains via the ?chain= query
 * param. Rendered only when more than one chain is configured; the default
 * chain's URL stays clean (no query param), so single-chain URLs never change
 * meaning.
 */
export default function ChainSwitcher({
  chains,
  defaultId,
}: {
  chains: Array<{ id: number; label: string }>;
  defaultId: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = Number(searchParams.get("chain") ?? defaultId);

  function hrefFor(id: number): string {
    const params = new URLSearchParams(searchParams.toString());
    if (id === defaultId) params.delete("chain");
    else params.set("chain", String(id));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container p-1">
      {chains.map((c) => (
        <Link
          key={c.id}
          href={hrefFor(c.id)}
          className={
            current === c.id
              ? "px-3 py-1 rounded-full text-label-sm bg-primary-container text-on-primary-container"
              : "px-3 py-1 rounded-full text-label-sm text-on-surface-variant hover:text-primary transition-colors"
          }
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

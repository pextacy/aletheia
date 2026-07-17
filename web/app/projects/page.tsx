import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, TopNav } from "../../components/Chrome";
import { EXPLORER_URL } from "../../lib/chain";
import { fetchAllProjects, type ExplorerProject } from "../../lib/indexer";

// The full registry is live chain state — always render fresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aletheia | all sealed records",
  description:
    "Every repository registered on Aletheia, straight from the Monad registry — searchable, with live sealed and active status.",
};

const ICONS = ["terminal", "memory", "account_balance", "hub", "dns", "code"];

function repoName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

type Status = "all" | "sealed" | "active";

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "primary" | "secondary" }) {
  const color =
    tone === "primary" ? "text-primary" : tone === "secondary" ? "text-secondary" : "text-on-surface";
  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6">
      <div className={`font-display text-headline-xl ${color}`}>{value}</div>
      <div className="text-label-sm uppercase tracking-widest text-on-surface-variant mt-1">
        {label}
      </div>
    </div>
  );
}

function FilterTab({
  status,
  current,
  q,
  label,
  count,
}: {
  status: Status;
  current: Status;
  q: string;
  label: string;
  count: number;
}) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  const href = params.toString() ? `/projects?${params.toString()}` : "/projects";
  const activeCls =
    status === current
      ? "bg-primary-container text-on-primary-container"
      : "bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline-variant/30";
  return (
    <Link
      href={href}
      className={`px-4 py-2 rounded-lg text-label-sm uppercase tracking-widest transition-all ${activeCls}`}
    >
      {label} <span className="opacity-60">{count}</span>
    </Link>
  );
}

function ProjectCard({ p, i }: { p: ExplorerProject; i: number }) {
  const sealed = p.sealedAt !== null;
  return (
    <Link
      href={`/p/${p.projectId}`}
      className="glass-panel p-6 rounded-xl hover:-translate-y-1 transition-all duration-300 block"
    >
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 bg-surface-variant rounded flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-2xl">
            {ICONS[i % ICONS.length]}
          </span>
        </div>
        <span
          className={`px-3 py-1 text-label-sm rounded uppercase flex items-center gap-1 border ${
            sealed
              ? "bg-primary-container/10 border-primary/30 text-primary"
              : "bg-secondary-container/10 border-secondary-container/30 text-secondary-container"
          }`}
        >
          <span className="material-symbols-outlined ms-fill text-[14px]">
            {sealed ? "lock" : "check_circle"}
          </span>
          {sealed ? "Sealed" : "Active"}
        </span>
      </div>
      <h4 className="font-display text-headline-lg-mobile mb-2 truncate">{repoName(p.repoUrl)}</h4>
      <p className="text-on-surface-variant text-body-md mb-6">
        {sealed ? `Sealed ${fmtDate(p.sealedAt!)}.` : `Registered ${fmtDate(p.timestamp)}.`}
      </p>
      <div className="pt-6 border-t border-outline-variant/20 flex justify-between items-center">
        <span className="font-mono text-mono-data text-outline">project #{p.projectId}</span>
        <span className="font-mono text-mono-data text-primary">
          {p.owner.slice(0, 6)}…{p.owner.slice(-4)}
        </span>
      </div>
    </Link>
  );
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status: Status =
    sp.status === "sealed" || sp.status === "active"
      ? sp.status
      : "all";

  const all = await fetchAllProjects().catch(() => [] as ExplorerProject[]);
  const sealedCount = all.filter((p) => p.sealedAt !== null).length;
  const activeCount = all.length - sealedCount;

  const needle = q.toLowerCase();
  const filtered = all.filter((p) => {
    const matchesStatus =
      status === "all" ||
      (status === "sealed" && p.sealedAt !== null) ||
      (status === "active" && p.sealedAt === null);
    const matchesQuery =
      !needle ||
      p.repoUrl.toLowerCase().includes(needle) ||
      p.owner.toLowerCase().includes(needle) ||
      String(p.projectId) === needle;
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav active="projects" />
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Header */}
        <section className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
            <span className="material-symbols-outlined ms-fill text-secondary text-[16px]">
              inventory_2
            </span>
            <span className="text-secondary text-label-sm tracking-wider uppercase">
              The full registry
            </span>
          </div>
          <h1 className="font-display text-[32px] leading-[1.1] sm:text-[40px] md:text-headline-xl mb-6">
            Every record, <span className="text-primary bloom-fuchsia-text">straight from the chain.</span>
          </h1>
          <p className="text-body-md text-on-surface-variant max-w-2xl mb-10">
            Each card is a repository bound to Monad. Search by repo, owner, or project id, and
            filter by whether the record is still accepting pushes or permanently sealed.
          </p>
          <div className="grid grid-cols-3 gap-gutter max-w-2xl">
            <StatBox label="Repositories" value={String(all.length)} />
            <StatBox label="Sealed" value={String(sealedCount)} tone="primary" />
            <StatBox label="Active" value={String(activeCount)} tone="secondary" />
          </div>
        </section>

        {/* Filters */}
        <section className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex gap-2 flex-wrap">
            <FilterTab status="all" current={status} q={q} label="All" count={all.length} />
            <FilterTab status="sealed" current={status} q={q} label="Sealed" count={sealedCount} />
            <FilterTab status="active" current={status} q={q} label="Active" count={activeCount} />
          </div>
          <form action="/projects" method="get" className="flex items-center gap-2">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <div className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 focus-within:border-primary/60 transition-colors">
              <span className="material-symbols-outlined text-outline text-[20px]">search</span>
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="repo, owner, or #id"
                className="bg-transparent py-2 text-body-md text-on-surface placeholder:text-outline focus:outline-none font-mono w-48"
              />
            </div>
            <button
              type="submit"
              className="bg-surface-container border border-outline-variant/30 text-on-surface px-4 py-2 rounded-lg text-label-sm uppercase tracking-widest hover:border-primary/50 transition-all"
            >
              Search
            </button>
          </form>
        </section>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="glass-panel rounded-xl p-12 text-center">
            <span className="material-symbols-outlined text-outline text-4xl mb-4 block">
              {all.length === 0 ? "hourglass_empty" : "search_off"}
            </span>
            <p className="text-on-surface-variant text-body-md mb-6">
              {all.length === 0
                ? "No repositories registered yet. Be the first to seal a build."
                : q
                  ? `No records match "${q}".`
                  : "No records in this filter."}
            </p>
            {all.length === 0 ? (
              <Link
                href="/#register"
                className="inline-flex items-center gap-2 bg-primary-container text-on-primary-container px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 transition-all bloom-primary"
              >
                Register a repository
              </Link>
            ) : (
              <Link href="/projects" className="text-primary hover:underline text-label-sm uppercase">
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {filtered.map((p, i) => (
              <ProjectCard key={p.projectId} p={p} i={i} />
            ))}
          </div>
        )}

        <div className="mt-16 flex justify-center">
          <a
            href={EXPLORER_URL}
            className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-label-sm uppercase tracking-widest"
          >
            Read the registry on the block explorer
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, TopNav } from "../../components/Chrome";
import { EXPLORER_URL, explorerTx } from "../../lib/chain";
import { fetchRegistryStats, type DayPoint } from "../../lib/indexer";

// Aggregates live chain logs on every load — never cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aletheia | registry pulse",
  description:
    "Live analytics for the Aletheia registry — attestations over time, sealed vs active records, and the most-attested projects, all aggregated straight from Monad.",
};

function repoName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}
function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function Kpi({
  icon,
  value,
  label,
  tone,
}: {
  icon: string;
  value: string;
  label: string;
  tone: "primary" | "secondary" | "neutral";
}) {
  const color =
    tone === "primary" ? "text-primary" : tone === "secondary" ? "text-secondary" : "text-on-surface";
  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 flex flex-col justify-between min-h-[132px]">
      <span className={`material-symbols-outlined ${color}`}>{icon}</span>
      <div>
        <div className={`font-display text-headline-xl leading-none ${color}`}>{value}</div>
        <div className="text-label-sm uppercase tracking-widest text-on-surface-variant mt-2">
          {label}
        </div>
      </div>
    </div>
  );
}

/** Daily attestation volume as responsive CSS bars — no chart library. */
function AttestationBars({ series }: { series: DayPoint[] }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  return (
    <div>
      <div className="h-48 flex items-end gap-[3px]" role="img" aria-label="Attestations per day">
        {series.map((d) => (
          <div key={d.day} className="flex-1 min-w-[2px] flex items-end h-full">
            <div
              className="w-full bg-primary/60 hover:bg-primary rounded-t transition-colors"
              style={{ height: `${Math.max(d.count === 0 ? 0 : 4, (d.count / max) * 100)}%` }}
              title={`${d.day} · ${d.count} attestation${d.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 font-mono text-mono-data text-outline">
        <span>{series[0]?.day}</span>
        <span>peak {max}/day</span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/** Cumulative project registrations as a stretched SVG area. */
function CumulativeArea({ series }: { series: DayPoint[] }) {
  const w = 100;
  const h = 40;
  const max = Math.max(1, ...series.map((d) => d.cumulativeProjects));
  const n = series.length;
  const pts = series.map((d, i) => {
    const x = n <= 1 ? w : (i / (n - 1)) * w;
    const y = h - (d.cumulativeProjects / max) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-48"
        role="img"
        aria-label="Cumulative projects registered"
      >
        <defs>
          <linearGradient id="cum" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00dbe9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00dbe9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#cum)" />
        <polyline
          points={line}
          fill="none"
          stroke="#00dbe9"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between mt-3 font-mono text-mono-data text-outline">
        <span>{series[0]?.day}</span>
        <span>{max} total projects</span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
      <div className="mb-6">
        <h3 className="font-display text-headline-lg-mobile">{title}</h3>
        <p className="text-on-surface-variant text-body-md">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export default async function StatsPage() {
  const stats = await fetchRegistryStats();
  const active = Math.max(0, stats.projectCount - stats.sealedCount);
  const sealedPct = stats.projectCount ? (stats.sealedCount / stats.projectCount) * 100 : 0;
  const hasData = stats.projectCount > 0 || stats.attestationCount > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav active="stats" />
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Header */}
        <section className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
            <span className="material-symbols-outlined ms-fill text-secondary text-[16px]">
              monitoring
            </span>
            <span className="text-secondary text-label-sm tracking-wider uppercase">
              Registry pulse · aggregated on chain
            </span>
          </div>
          <h1 className="font-display text-[32px] leading-[1.1] sm:text-[40px] md:text-headline-xl mb-6">
            The whole registry, <span className="text-primary bloom-fuchsia-text">counted honestly.</span>
          </h1>
          <p className="text-body-md text-on-surface-variant max-w-2xl">
            Every number here is reduced from raw <span className="font-mono text-secondary">eth_getLogs</span>{" "}
            events — no analytics database, no mock data. Reload to recount straight from Monad.
            {stats.lastActivity !== null && (
              <>
                {" "}
                Last attestation seen <span className="text-secondary">{fmtDateTime(stats.lastActivity)}</span>.
              </>
            )}
          </p>
        </section>

        {/* KPI row */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-gutter mb-12">
          <Kpi icon="folder_managed" value={String(stats.projectCount)} label="Repositories" tone="neutral" />
          <Kpi icon="verified" value={String(stats.attestationCount)} label="Attestations" tone="primary" />
          <Kpi icon="lock" value={String(stats.sealedCount)} label="Sealed" tone="primary" />
          <Kpi icon="deployed_code" value={String(stats.linkedContractCount)} label="Linked contracts" tone="secondary" />
          <Kpi icon="group" value={String(stats.uniqueOwners)} label="Owners" tone="secondary" />
        </section>

        {!hasData ? (
          <div className="glass-panel rounded-xl p-12 text-center">
            <span className="material-symbols-outlined text-outline text-4xl mb-4 block">
              query_stats
            </span>
            <p className="text-on-surface-variant text-body-md mb-6">
              No activity on the registry yet. The first sealed push will light this dashboard up.
            </p>
            <Link
              href="/#register"
              className="inline-flex items-center gap-2 bg-primary-container text-on-primary-container px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 transition-all bloom-primary"
            >
              Register the first repository
            </Link>
          </div>
        ) : (
          <>
            {/* Charts */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter mb-12">
              <ChartCard
                title="Attestations per day"
                hint="Each bar is a UTC day; height is how many commits sealed that day."
              >
                <AttestationBars series={stats.series} />
              </ChartCard>
              <ChartCard
                title="Projects registered"
                hint="Cumulative repositories bound to the registry over time."
              >
                <CumulativeArea series={stats.series} />
              </ChartCard>
            </section>

            {/* Sealed vs active meter */}
            <section className="bg-surface-container border border-outline-variant/20 rounded-xl p-6 mb-12">
              <div className="flex items-end justify-between mb-4">
                <h3 className="font-display text-headline-lg-mobile">Record state</h3>
                <span className="font-mono text-mono-data text-outline">
                  {sealedPct.toFixed(0)}% sealed
                </span>
              </div>
              <div className="h-4 rounded-full overflow-hidden bg-surface-container-lowest flex">
                <div
                  className="bg-primary-container h-full"
                  style={{ width: `${sealedPct}%` }}
                  title={`${stats.sealedCount} sealed`}
                />
                <div
                  className="bg-secondary-container/40 h-full"
                  style={{ width: `${100 - sealedPct}%` }}
                  title={`${active} active`}
                />
              </div>
              <div className="flex gap-6 mt-4">
                <span className="flex items-center gap-2 text-body-md text-on-surface-variant">
                  <span className="w-3 h-3 rounded-sm bg-primary-container" /> {stats.sealedCount} sealed
                </span>
                <span className="flex items-center gap-2 text-body-md text-on-surface-variant">
                  <span className="w-3 h-3 rounded-sm bg-secondary-container/40" /> {active} active
                </span>
              </div>
            </section>

            {/* Leaderboard + recent activity */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
              <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
                <h3 className="font-display text-headline-lg-mobile mb-1">Most attested</h3>
                <p className="text-on-surface-variant text-body-md mb-6">
                  Projects ranked by how many commits they&apos;ve sealed.
                </p>
                <div className="space-y-2">
                  {stats.leaderboard.slice(0, 8).map((p, i) => {
                    const barMax = stats.leaderboard[0]?.attestations || 1;
                    return (
                      <Link
                        key={p.projectId}
                        href={`/p/${p.projectId}`}
                        className="block group"
                      >
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono text-mono-data text-outline w-6 shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="font-display text-body-md text-on-surface group-hover:text-primary transition-colors truncate flex-1 min-w-0">
                            {repoName(p.repoUrl) || `Project #${p.projectId}`}
                          </span>
                          {p.sealed && (
                            <span className="material-symbols-outlined ms-fill text-primary text-[16px] shrink-0">
                              lock
                            </span>
                          )}
                          <span className="font-mono text-mono-data text-primary shrink-0">
                            {p.attestations}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-surface-container-lowest ml-9 overflow-hidden">
                          <div
                            className="h-full bg-primary/50 group-hover:bg-primary transition-colors"
                            style={{ width: `${(p.attestations / barMax) * 100}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
                <h3 className="font-display text-headline-lg-mobile mb-1">Latest attestations</h3>
                <p className="text-on-surface-variant text-body-md mb-6">
                  The freshest seals across every project, newest first.
                </p>
                <div className="space-y-3">
                  {stats.recent.map((a, i) => (
                    <div
                      key={`${a.txHash}-${i}`}
                      className="flex items-center gap-3 pb-3 border-b border-outline-variant/10 last:border-0 last:pb-0"
                    >
                      <span className="material-symbols-outlined text-secondary text-[18px] shrink-0">
                        account_tree
                      </span>
                      <Link
                        href={`/p/${a.projectId}`}
                        className="font-display text-body-md text-on-surface hover:text-primary transition-colors truncate min-w-0 flex-1"
                      >
                        {repoName(a.repoUrl) || `Project #${a.projectId}`}
                      </Link>
                      <span className="font-mono text-mono-data text-outline shrink-0 hidden sm:inline">
                        {a.commitHash.slice(0, 8)}
                      </span>
                      <a
                        href={explorerTx(a.txHash)}
                        className="font-mono text-mono-data text-secondary shrink-0"
                        title={fmtDateTime(a.timestamp)}
                      >
                        {fmtDate(a.timestamp)} ↗
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        <div className="mt-16 flex justify-center">
          <a
            href={EXPLORER_URL}
            className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-label-sm uppercase tracking-widest"
          >
            Verify these counts on the block explorer
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

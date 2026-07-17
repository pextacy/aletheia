import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EXPLORER_URL, HACKATHON_START, explorerAddress, explorerTx } from "../../../lib/chain";
import { fetchCommitMeta } from "../../../lib/github";
import { fetchProject } from "../../../lib/indexer";

export const revalidate = 30;

function fmt(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function offsetFromStart(ts: number): string {
  const ms = ts * 1000 - HACKATHON_START.getTime();
  const sign = ms < 0 ? "−" : "+";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${sign}${h}h ${m}m`;
}

export async function generateMetadata({
  params,
}: {
  params: { projectId: string };
}): Promise<Metadata> {
  return {
    title: `Aletheia — proof of project #${params.projectId}`,
    openGraph: { images: [`/api/og/${params.projectId}`] },
  };
}

export default async function ProofPage({ params }: { params: { projectId: string } }) {
  const id = Number(params.projectId);
  if (!Number.isInteger(id) || id < 1) notFound();

  const project = await fetchProject(id);
  if (!project) notFound();

  const commitShas = project.timeline
    .filter((e) => e.kind === "attestation")
    .map((e) => (e.kind === "attestation" ? e.commitHash : ""));
  const meta = project.repoFullName
    ? await fetchCommitMeta(project.repoFullName, commitShas)
    : new Map();

  const sealed = project.sealedAt !== null;
  const firstAttestation = project.timeline.find((e) => e.kind === "attestation");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <header className="mb-10 text-center">
        <p className="font-display text-oxblood text-lg tracking-[0.3em] uppercase">Aletheia</p>
        <h1 className="font-display mt-2 text-4xl sm:text-5xl font-semibold break-words">
          {project.repoFullName ?? `Project #${project.projectId}`}
        </h1>
        <p className="mt-2 text-ink-soft">
          <a className="underline decoration-line hover:decoration-oxblood" href={project.repoUrl}>
            {project.repoUrl}
          </a>
        </p>
      </header>

      {/* Summary strip */}
      <section
        className={`relative border ${sealed ? "border-oxblood" : "border-line"} bg-white/40 px-6 py-5 mb-12`}
      >
        {sealed && (
          <div
            aria-label="sealed"
            className="absolute -top-5 -right-4 h-16 w-16 rounded-full bg-oxblood text-parchment
                       flex items-center justify-center rotate-12 shadow-lg"
          >
            <span className="font-display text-xs leading-tight text-center">
              SEALED
              <br />
              ἀλήθεια
            </span>
          </div>
        )}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-ink-soft">First attestation</dt>
            <dd className="font-medium">{firstAttestation ? fmt(firstAttestation.timestamp) : "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Offset from start</dt>
            <dd className="font-medium">
              {firstAttestation ? offsetFromStart(firstAttestation.timestamp) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Attestations</dt>
            <dd className="font-medium">{project.attestationCount}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Record</dt>
            <dd className={`font-medium ${sealed ? "text-oxblood" : ""}`}>
              {sealed ? (
                project.sealTxHash ? (
                  <a className="underline" href={explorerTx(project.sealTxHash)}>
                    sealed {fmt(project.sealedAt!)}
                  </a>
                ) : (
                  `sealed ${fmt(project.sealedAt!)}`
                )
              ) : (
                "open"
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Column timeline */}
      <section className="relative">
        <div className="absolute left-4 sm:left-1/2 top-0 bottom-0 w-px bg-line" aria-hidden />
        <ol className="space-y-10">
          <li className="relative pl-12 sm:pl-0">
            <TimelineDot />
            <div className="sm:w-[calc(50%-2rem)] sm:ml-auto sm:pl-8">
              <p className="text-xs text-ink-soft">{fmt(project.createdAt)}</p>
              <p className="font-display text-xl">Project registered</p>
              <p className="text-sm text-ink-soft break-all">
                owner{" "}
                <a className="underline" href={explorerAddress(project.owner)}>
                  {project.owner.slice(0, 10)}…
                </a>
              </p>
            </div>
          </li>

          {project.timeline.map((entry, i) => (
            <li key={i} className="relative pl-12 sm:pl-0">
              <TimelineDot accent={entry.kind === "contract"} />
              <div
                className={`sm:w-[calc(50%-2rem)] ${i % 2 === 0 ? "sm:pr-8 sm:text-right" : "sm:ml-auto sm:pl-8"}`}
              >
                {entry.kind === "attestation" ? (
                  <>
                    <p className="text-xs text-ink-soft">{fmt(entry.timestamp)}</p>
                    <p className="font-display text-xl break-words">
                      {meta.get(entry.commitHash)?.message ?? "Commit attested"}
                    </p>
                    <p className="text-sm text-ink-soft">
                      <code className="text-oxblood">{entry.commitHash.slice(0, 12)}</code>
                      {meta.get(entry.commitHash)?.author
                        ? ` · ${meta.get(entry.commitHash)!.author}`
                        : ""}
                    </p>
                    <p className="text-xs mt-1">
                      <a className="underline text-ink-soft" href={explorerTx(entry.txHash)}>
                        view on explorer ↗
                      </a>
                      <span className="ml-2 text-green-800">✓ on-chain</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-ink-soft">{fmt(entry.timestamp)}</p>
                    <p className="font-display text-xl">
                      Contract linked · <span className="text-oxblood">{entry.label}</span>
                    </p>
                    <p className="text-xs mt-1 break-all">
                      <a className="underline text-ink-soft" href={explorerAddress(entry.address)}>
                        {entry.address} ↗
                      </a>
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}

          {sealed && (
            <li className="relative pl-12 sm:pl-0">
              <TimelineDot seal />
              <div className="sm:w-[calc(50%-2rem)] sm:ml-auto sm:pl-8">
                <p className="text-xs text-ink-soft">{fmt(project.sealedAt!)}</p>
                <p className="font-display text-2xl text-oxblood">Record sealed</p>
                <p className="text-sm text-ink-soft">No further attestations are possible.</p>
              </div>
            </li>
          )}
        </ol>
      </section>

      {/* Verify block */}
      <section className="mt-16 border border-line bg-white/40 p-6">
        <h2 className="font-display text-2xl mb-2">Verify this record yourself</h2>
        <p className="text-sm text-ink-soft mb-3">
          No trust required — recompute every hash from a fresh clone and compare against the chain:
        </p>
        <pre className="bg-ink text-parchment text-sm px-4 py-3 overflow-x-auto">
          <code>npx aletheia-verify {project.projectId}</code>
        </pre>
        <p className="text-xs text-ink-soft mt-3">
          Aletheia proves <em>existence by time</em> and <em>continuity</em> — not authorship. Explorer:{" "}
          <a className="underline" href={EXPLORER_URL}>
            {EXPLORER_URL.replace("https://", "")}
          </a>
        </p>
      </section>

      <footer className="mt-12 text-center text-xs text-ink-soft">
        <Link className="underline" href="/">
          ← all projects
        </Link>
      </footer>
    </main>
  );
}

function TimelineDot({ accent, seal }: { accent?: boolean; seal?: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute left-4 sm:left-1/2 -translate-x-1/2 top-1 block rounded-full
        ${seal ? "h-5 w-5 bg-oxblood ring-4 ring-oxblood/20" : accent ? "h-3.5 w-3.5 bg-oxblood" : "h-3 w-3 bg-ink"}`}
    />
  );
}

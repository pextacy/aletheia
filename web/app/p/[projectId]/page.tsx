import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, TopNav } from "../../../components/Chrome";
import { EXPLORER_URL, HACKATHON_START, explorerAddress, explorerTx } from "../../../lib/chain";
import { fetchCommitMeta, fetchForcedCommits } from "../../../lib/github";
import { fetchProject, type ProjectModel } from "../../../lib/indexer";
import { fetchVerification, verdictMap, type Verdict } from "../../../lib/verify";

export const revalidate = 30;

function fmtClock(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(11, 19) + " UTC";
}
function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}
function offsetFromStart(ts: number): string {
  const ms = ts * 1000 - HACKATHON_START.getTime();
  const sign = ms < 0 ? "−" : "+";
  const abs = Math.abs(ms);
  return `${sign}${Math.floor(abs / 3_600_000)}h ${Math.floor((abs % 3_600_000) / 60_000)}m`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  return {
    title: `Aletheia | proof of project #${projectId}`,
    openGraph: { images: [`/api/og/${projectId}`] },
  };
}

type Tone = "cyan" | "fuchsia" | "error";

interface TimelineNode {
  time: number;
  tone: Tone;
  icon: string;
  title: string;
  card: React.ReactNode;
  seal?: boolean;
}

const nodeRing: Record<Tone, string> = {
  cyan: "border-secondary bloom-cyan text-secondary",
  fuchsia: "border-primary bloom-primary text-primary",
  error: "border-error bloom-error text-error animate-pulse",
};
const dateTone: Record<Tone, string> = {
  cyan: "text-secondary",
  fuchsia: "text-primary",
  error: "text-error",
};

function VerifyBadge({ verdict }: { verdict: Verdict | undefined }) {
  if (verdict === "verified") {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-secondary">
        <span className="material-symbols-outlined ms-fill text-[14px]">verified</span>
        tree verified
      </span>
    );
  }
  if (verdict === "mismatched") {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-error">
        <span className="material-symbols-outlined ms-fill text-[14px]">cancel</span>
        content substituted
      </span>
    );
  }
  if (verdict === "missing") {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-error">
        <span className="material-symbols-outlined ms-fill text-[14px]">error</span>
        commit missing
      </span>
    );
  }
  // No verification report available — the attestation exists on chain but
  // hasn't been independently re-verified by the service.
  return <span className="ml-2 text-green-500/80">✓ on-chain</span>;
}

function buildNodes(
  project: ProjectModel,
  meta: Map<string, { message: string; author: string }>,
  forced: Set<string>,
  verdicts: Map<string, Verdict>
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  nodes.push({
    time: project.createdAt,
    tone: "cyan",
    icon: "app_registration",
    title: "Registration",
    card: (
      <>
        <p className="text-on-surface-variant text-body-md mb-4">
          Repository bound to the registry and its attestor key. Every push from here is sealed.
        </p>
        <div className="bg-surface-container-lowest p-3 rounded font-mono text-mono-data text-secondary truncate">
          owner&nbsp;{project.owner}
        </div>
      </>
    ),
  });

  for (const entry of project.timeline) {
    if (entry.kind === "attestation") {
      const isForced = forced.has(entry.commitHash);
      const m = meta.get(entry.commitHash);
      if (isForced) {
        nodes.push({
          time: entry.timestamp,
          tone: "error",
          icon: "warning",
          title: "History force-push",
          card: (
            <div className="relative">
              <div className="absolute -top-3 -right-3 bg-error text-on-error px-2 py-1 rounded text-[10px] font-black uppercase">
                Rewrite marked
              </div>
              <p className="text-on-error-container text-body-md mb-4">
                This push rewrote history. The new head is still sealed at a real time — the rewrite
                is shown, not hidden.
              </p>
              <a
                href={explorerTx(entry.txHash)}
                className="text-error text-label-sm uppercase underline hover:text-on-surface transition-colors"
              >
                View on explorer
              </a>
            </div>
          ),
        });
      } else {
        const verdict = verdicts.get(entry.commitHash.toLowerCase());
        const bad = verdict === "mismatched" || verdict === "missing";
        nodes.push({
          time: entry.timestamp,
          tone: bad ? "error" : "fuchsia",
          icon: bad ? "gpp_bad" : "account_tree",
          title: m?.message ?? "Commit attested",
          card: (
            <>
              <p className="text-on-surface-variant text-body-md mb-4">
                Commit and tree hash sealed on chain{m?.author ? ` · ${m.author}` : ""}.
              </p>
              <div className="bg-surface-container-lowest p-3 rounded font-mono text-mono-data text-primary flex items-center justify-between gap-3">
                <span className="truncate min-w-0">{entry.commitHash.slice(0, 18)}…</span>
                <a href={explorerTx(entry.txHash)} className="shrink-0 text-secondary uppercase">
                  tx ↗
                </a>
              </div>
              <p className="text-mono-data font-mono mt-2 text-outline">
                <VerifyBadge verdict={verdict} />
              </p>
            </>
          ),
        });
      }
    } else {
      nodes.push({
        time: entry.timestamp,
        tone: "cyan",
        icon: "deployed_code",
        title: `Contract linked · ${entry.label}`,
        card: (
          <div className="bg-surface-container-lowest p-3 rounded font-mono text-mono-data text-on-surface-variant flex items-center justify-between gap-3">
            <span className="truncate min-w-0">{entry.address}</span>
            <a href={explorerAddress(entry.address)} className="shrink-0 text-secondary uppercase">
              ↗
            </a>
          </div>
        ),
      });
    }
  }

  if (project.sealedAt !== null) {
    nodes.push({
      time: project.sealedAt,
      tone: "fuchsia",
      icon: "lock",
      title: "Sealed state",
      seal: true,
      card: (
        <p className="text-on-surface text-body-md">
          The record is closed. Every further attestation reverts — the proof cycle is complete.
        </p>
      ),
    });
  }

  return nodes;
}

function NodeRow({ node, index }: { node: TimelineNode; index: number }) {
  const cardRight = index % 2 === 0;
  const date = (
    <div className={`hidden md:block w-5/12 ${cardRight ? "text-right pr-12" : "text-left pl-12"}`}>
      <span className={`font-mono text-mono-data ${dateTone[node.tone]}`}>{fmtClock(node.time)}</span>
    </div>
  );
  const dot = (
    <div
      className={`z-20 shrink-0 rounded-full bg-background border-4 flex items-center justify-center ${
        node.seal ? "w-16 h-16 border-primary-container seal-bloom" : `w-12 h-12 ${nodeRing[node.tone]}`
      }`}
    >
      <span
        className={`material-symbols-outlined ms-fill ${node.seal ? "text-primary text-3xl" : ""}`}
      >
        {node.icon}
      </span>
    </div>
  );
  const cardWrap = node.seal
    ? "bg-surface-container-high p-8 rounded-xl border-2 border-primary-container/40"
    : node.tone === "error"
      ? "bg-error-container/20 p-6 rounded-xl border border-error/50"
      : "bg-surface-container p-6 rounded-xl border border-outline-variant/20 hover:border-primary/40 transition-all";
  const card = (
    <div className={`w-full md:w-5/12 mt-4 md:mt-0 ${cardRight ? "md:pl-12" : "md:pr-12"}`}>
      <div className={cardWrap}>
        <h3
          className={`font-display ${node.seal ? "text-headline-lg" : "text-headline-lg-mobile"} mb-2 ${
            node.tone === "error" ? "text-error" : node.seal ? "text-primary" : "text-on-surface"
          }`}
        >
          {node.title}
        </h3>
        {node.card}
        <div className="md:hidden mt-3 font-mono text-mono-data text-outline">
          {fmtClock(node.time)}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`flex flex-col items-center justify-between w-full ${
        cardRight ? "md:flex-row" : "md:flex-row-reverse"
      }`}
    >
      {date}
      {dot}
      {card}
    </div>
  );
}

export default async function ProofPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1) notFound();

  const project = await fetchProject(id);
  if (!project) notFound();

  const commitShas = project.timeline
    .filter((e) => e.kind === "attestation")
    .map((e) => (e.kind === "attestation" ? e.commitHash : ""));
  const [meta, forced, verification] = await Promise.all([
    project.repoFullName
      ? fetchCommitMeta(project.repoFullName, commitShas)
      : Promise.resolve(new Map<string, { message: string; author: string }>()),
    fetchForcedCommits(project.projectId),
    fetchVerification(project.projectId),
  ]);

  const sealed = project.sealedAt !== null;
  const firstAttestation = project.timeline.find((e) => e.kind === "attestation");
  const verdicts = verdictMap(verification);
  const nodes = buildNodes(project, meta, forced, verdicts);
  const title = project.repoFullName ?? `Project #${project.projectId}`;
  const verifyCmd = `npx aletheia-verify ${project.projectId}`;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav active="proofs" />
      <main className="flex-grow pt-24 pb-12 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Header bento */}
        <header className="mb-12 grid grid-cols-1 md:grid-cols-12 gap-gutter">
          <div className="md:col-span-8 p-8 bg-surface-container border border-outline-variant/30 rounded-xl flex flex-col justify-end min-h-[240px] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined ms-fill text-[120px]">security</span>
            </div>
            <div className="z-10">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-label-sm border ${
                    sealed
                      ? "bg-primary-container/20 text-primary border-primary/30"
                      : "bg-secondary-container/20 text-secondary border-secondary/30"
                  }`}
                >
                  {sealed ? "SEALED RECORD" : "ACTIVE RECORD"}
                </span>
                <span className="text-on-surface-variant font-mono text-mono-data">
                  PROJECT ID: #{project.projectId}
                </span>
              </div>
              <h1 className="font-display text-[28px] leading-tight sm:text-[36px] md:text-headline-xl text-on-surface mb-2 break-all">
                {title}
              </h1>
              <p className="text-on-surface-variant text-body-md max-w-xl">
                <a href={project.repoUrl} className="hover:text-primary transition-colors">
                  {project.repoUrl}
                </a>
              </p>
            </div>
          </div>
          <div className="md:col-span-4 grid grid-rows-2 gap-gutter">
            <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 flex flex-col justify-between">
              <span className="text-on-surface-variant text-label-sm uppercase">
                First attestation
              </span>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-secondary">schedule</span>
                <span className="text-headline-lg-mobile font-display text-secondary">
                  {firstAttestation ? fmtDate(firstAttestation.timestamp) : "—"}
                </span>
              </div>
              <span className="font-mono text-mono-data text-outline">
                {firstAttestation ? `${offsetFromStart(firstAttestation.timestamp)} from start` : ""}
              </span>
            </div>
            <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 flex flex-col justify-between">
              <span className="text-on-surface-variant text-label-sm uppercase">
                Verification count
              </span>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined ms-fill text-primary">verified</span>
                <span className="text-headline-lg font-display text-primary">
                  {project.attestationCount} attestations
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Independent-verification banner */}
        {verification && (
          <div
            className={`mb-12 rounded-xl border px-6 py-4 flex items-center gap-4 ${
              verification.ok
                ? "bg-secondary-container/10 border-secondary/40 bloom-cyan"
                : "bg-error-container/20 border-error/50 bloom-error"
            }`}
          >
            <span
              className={`material-symbols-outlined ms-fill text-3xl ${
                verification.ok ? "text-secondary" : "text-error"
              }`}
            >
              {verification.ok ? "verified_user" : "gpp_bad"}
            </span>
            <div className="min-w-0">
              <div
                className={`font-display text-headline-lg-mobile ${
                  verification.ok ? "text-secondary" : "text-error"
                }`}
              >
                {verification.ok
                  ? "Independently verified"
                  : "Verification found unreproducible attestations"}
              </div>
              <p className="text-on-surface-variant text-body-md">
                {verification.ok
                  ? `All ${verification.summary.verified} attested commits reproduce their tree hashes from a fresh clone of the repository.`
                  : `${verification.summary.verified} verified · ${verification.summary.missing} missing · ${verification.summary.mismatched} mismatched. Re-derived from a fresh clone — the chain and the repo disagree.`}
              </p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <section className="relative py-8">
          <div className="absolute left-6 md:left-1/2 top-0 bottom-0 w-px timeline-line opacity-30 md:-translate-x-1/2" />
          <div className="space-y-16 md:space-y-24 relative pl-0 md:pl-0">
            {nodes.map((node, i) => (
              <NodeRow key={i} node={node} index={i} />
            ))}
          </div>
        </section>

        {/* Verify terminal */}
        <section className="mt-20">
          <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden shadow-2xl">
            <div className="bg-surface-container px-4 py-2 flex items-center justify-between border-b border-outline-variant/20">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-error/40" />
                <div className="w-3 h-3 rounded-full bg-primary/40" />
                <div className="w-3 h-3 rounded-full bg-secondary/40" />
              </div>
              <div className="text-on-surface-variant text-label-sm uppercase tracking-widest">
                Independent verification
              </div>
              <div className="w-8" />
            </div>
            <div className="p-6 font-mono text-mono-data bg-black/40">
              <div className="text-secondary mb-3">$ {verifyCmd}</div>
              <div className="text-on-surface-variant opacity-70">
                # clones the repo blobless and recomputes every commit + tree hash
              </div>
              <div className="text-on-surface-variant opacity-70">
                # compares each pair against this project&apos;s on-chain attestations
              </div>
              <div className="text-on-surface-variant opacity-70">
                # exits non-zero if any attested commit can&apos;t be reproduced
              </div>
              <div className="text-primary mt-3">
                No keys, no writes, no trust in Aletheia&apos;s servers — just Node and git.
              </div>
              <div className="text-outline mt-1">
                explorer {EXPLORER_URL.replace("https://", "")}
              </div>
              <div className="mt-3 flex items-center">
                <span className="text-secondary animate-pulse">_</span>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-mono-data font-mono text-outline">
            Aletheia proves existence by time and continuity — not authorship.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

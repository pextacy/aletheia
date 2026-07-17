import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, TopNav } from "../../components/Chrome";
import { EXPLORER_URL, explorerAddress } from "../../lib/chain";
import { fetchProject, lookupProjectByRepo, type RepoLookup } from "../../lib/indexer";

// The result depends on live chain state and the ?repo query — never cache it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aletheia | verify a repository",
  description:
    "Paste a GitHub repository URL to check its on-chain build provenance — is it registered on Aletheia, and is its record sealed?",
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function repoName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

function HashRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <span className="truncate min-w-0 text-secondary">{value}</span>
  );
  return (
    <div className="bg-surface-container-lowest p-3 rounded font-mono text-mono-data flex items-center justify-between gap-3">
      <span className="shrink-0 text-outline uppercase">{label}</span>
      {href ? (
        <a href={href} className="truncate min-w-0 text-secondary hover:underline">
          {value}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}

/** Registered repo → the full provenance summary and links into the proof. */
async function FoundResult({ lookup }: { lookup: RepoLookup }) {
  const project = await fetchProject(lookup.projectId);
  if (!project) {
    // Extremely rare: projectByRepo pointed at an id the reader couldn't load.
    return <NotFoundResult lookup={lookup} />;
  }

  const sealed = project.sealedAt !== null;
  const firstAttestation = project.timeline.find((e) => e.kind === "attestation");
  const verifyCmd = `npx aletheia-verify ${project.projectId}`;

  return (
    <div className="glass-panel rounded-xl p-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-secondary-container/20 flex items-center justify-center bloom-cyan shrink-0">
            <span className="material-symbols-outlined ms-fill text-secondary text-2xl">
              verified
            </span>
          </div>
          <div>
            <div className="text-label-sm uppercase tracking-widest text-secondary mb-1">
              Registered on chain
            </div>
            <h2 className="font-display text-headline-lg-mobile break-all">
              {project.repoFullName ?? repoName(project.repoUrl)}
            </h2>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-label-sm border shrink-0 ${
            sealed
              ? "bg-primary-container/20 text-primary border-primary/30"
              : "bg-secondary-container/20 text-secondary border-secondary/30"
          }`}
        >
          {sealed ? "SEALED RECORD" : "ACTIVE RECORD"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Project ID" value={`#${project.projectId}`} />
        <Stat label="Attestations" value={String(project.attestationCount)} tone="primary" />
        <Stat
          label="First attestation"
          value={firstAttestation ? fmtDate(firstAttestation.timestamp).slice(0, 10) : "—"}
        />
        <Stat label={sealed ? "Sealed" : "Registered"} value={fmtDate(project.sealedAt ?? project.createdAt).slice(0, 10)} />
      </div>

      <div className="space-y-2 mb-8">
        <HashRow label="repoHash" value={lookup.repoHash ?? ""} />
        <HashRow label="owner" value={project.owner} href={explorerAddress(project.owner)} />
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href={`/p/${project.projectId}`}
          className="flex-1 bg-primary-container text-on-primary-container px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:brightness-110 active:scale-95 transition-all bloom-primary flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">account_tree</span>
          View full proof timeline
        </Link>
        <a
          href={project.repoUrl}
          className="flex-1 border border-outline-variant/40 text-on-surface px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:border-primary/50 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">open_in_new</span>
          Open repository
        </a>
      </div>

      <div className="mt-8 pt-6 border-t border-outline-variant/20">
        <p className="text-on-surface-variant text-body-md mb-3">
          On-chain lookup confirms the repository is <span className="text-secondary">bound to the registry</span>.
          To re-derive every commit and tree hash from a fresh clone and match them against these
          attestations, run the independent CLI — no keys, no trust in Aletheia&apos;s servers:
        </p>
        <div className="bg-black/40 border border-outline-variant/30 rounded-lg p-4 font-mono text-mono-data">
          <span className="text-secondary">$ {verifyCmd}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="bg-surface-container-lowest rounded-lg p-4">
      <div className="text-label-sm uppercase tracking-wider text-outline mb-1">{label}</div>
      <div
        className={`font-display text-headline-lg-mobile ${
          tone === "primary" ? "text-primary" : "text-on-surface"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Valid GitHub URL, but no repo hashes to this key on chain. */
function NotFoundResult({ lookup }: { lookup: RepoLookup }) {
  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-surface-variant flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-on-surface-variant text-2xl">
            help
          </span>
        </div>
        <div>
          <div className="text-label-sm uppercase tracking-widest text-on-surface-variant mb-1">
            Not registered
          </div>
          <h2 className="font-display text-headline-lg-mobile break-all">{lookup.path}</h2>
        </div>
      </div>
      <p className="text-on-surface-variant text-body-md mb-6">
        No project on the registry hashes to this repository. Its build history is not yet sealed on
        Monad — the absence itself is verifiable: anyone can recompute the key below and read the same
        empty slot from the chain.
      </p>
      <div className="space-y-2 mb-6">
        <HashRow label="repoHash" value={lookup.repoHash ?? ""} />
      </div>
      <Link
        href="/#register"
        className="inline-flex items-center gap-2 bg-primary-container text-on-primary-container px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all bloom-primary"
      >
        <span className="material-symbols-outlined text-[18px]">app_registration</span>
        Register this repository
      </Link>
    </div>
  );
}

/** The input didn't parse as a GitHub repo URL at all. */
function InvalidResult({ raw }: { raw: string }) {
  return (
    <div className="bg-error-container/20 border border-error/40 rounded-xl p-8">
      <div className="flex items-center gap-3 mb-3">
        <span className="material-symbols-outlined text-error text-3xl">error</span>
        <h2 className="font-display text-headline-lg-mobile text-error">Not a repository URL</h2>
      </div>
      <p className="text-on-error-container text-body-md">
        <span className="font-mono break-all">{raw}</span> doesn&apos;t look like a GitHub repository.
        Try a URL such as <span className="text-secondary font-mono">github.com/owner/repo</span>.
      </p>
    </div>
  );
}

async function Result({ raw }: { raw: string }) {
  const lookup = await lookupProjectByRepo(raw);
  if (!lookup.path) return <InvalidResult raw={raw} />;
  if (lookup.projectId < 1) return <NotFoundResult lookup={lookup} />;
  return <FoundResult lookup={lookup} />;
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: { repo?: string };
}) {
  const raw = (searchParams.repo ?? "").trim();

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav active="verify" />
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        <section className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
            <span className="material-symbols-outlined ms-fill text-secondary text-[16px]">
              travel_explore
            </span>
            <span className="text-secondary text-label-sm tracking-wider uppercase">
              Trustless on-chain lookup
            </span>
          </div>
          <h1 className="font-display text-[32px] leading-[1.1] sm:text-[40px] md:text-headline-xl mb-6">
            Verify a repository&apos;s <span className="text-primary bloom-fuchsia-text">provenance.</span>
          </h1>
          <p className="text-body-md text-on-surface-variant mb-10">
            Paste a GitHub repository URL. Aletheia recomputes its canonical <span className="font-mono text-secondary">repoHash</span> —
            the same keccak256 anyone can derive — and reads the registry straight from Monad to tell
            you whether the repo is sealed, and where to find its proof.
          </p>

          <form action="/verify" method="get" className="mb-16">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex items-center gap-3 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 focus-within:border-primary/60 transition-colors">
                <span className="material-symbols-outlined text-outline">link</span>
                <input
                  type="text"
                  name="repo"
                  defaultValue={raw}
                  autoFocus
                  placeholder="github.com/owner/repo"
                  className="flex-1 bg-transparent py-3 text-body-md text-on-surface placeholder:text-outline focus:outline-none font-mono"
                />
              </div>
              <button
                type="submit"
                className="bg-primary-container text-on-primary-container px-8 py-3 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all bloom-primary"
              >
                Verify
              </button>
            </div>
          </form>

          {raw ? (
            <div className="mb-16">
              <Result raw={raw} />
            </div>
          ) : (
            <div className="mb-16 grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  icon: "tag",
                  title: "1 · Hash",
                  body: "The repo URL is reduced to github.com/owner/repo and keccak256-hashed — the deterministic key the registry stores under.",
                },
                {
                  icon: "hub",
                  title: "2 · Read chain",
                  body: "projectByRepo(repoHash) is read directly from Monad. A non-zero id means the build history is sealed on-chain.",
                },
                {
                  icon: "terminal",
                  title: "3 · Re-verify",
                  body: "Run npx aletheia-verify <id> to recompute every commit and tree hash from a fresh clone — zero trust in this site.",
                },
              ].map((c) => (
                <div
                  key={c.title}
                  className="bg-surface-container border border-outline-variant/20 rounded-xl p-6"
                >
                  <span className="material-symbols-outlined text-primary text-2xl mb-4 block">
                    {c.icon}
                  </span>
                  <h3 className="font-display text-headline-lg-mobile mb-2">{c.title}</h3>
                  <p className="text-on-surface-variant text-body-md">{c.body}</p>
                </div>
              ))}
            </div>
          )}

          <div className="glass-panel rounded-xl p-6 cyber-grid relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="font-display text-headline-lg-mobile mb-2">Two layers of trust</h3>
              <p className="text-on-surface-variant text-body-md">
                This page proves <span className="text-secondary">registration and timing</span> —
                that a repository was bound to the chain and when. Full re-verification of the commit
                and tree hashes is the CLI&apos;s job, and it needs nothing from Aletheia but the public
                registry. Read the registry yourself on the{" "}
                <a href={EXPLORER_URL} className="text-primary hover:underline">
                  block explorer
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, TopNav } from "../../components/Chrome";
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, HACKATHON_START } from "../../lib/chain";

// Pure static explainer — no chain reads, safe to prerender.
export const dynamic = "force-static";

const REPO_URL = "https://github.com/pextacy/aletheia";

export const metadata: Metadata = {
  title: "Aletheia | how it works",
  description:
    "The architecture, contract interface, and threat model behind Aletheia — how a Git push becomes an immutable, independently verifiable on-chain proof.",
};

const SECTIONS = [
  { id: "overview", label: "What it proves" },
  { id: "architecture", label: "Architecture" },
  { id: "tree-hash", label: "Why the tree hash" },
  { id: "paths", label: "Two attestation paths" },
  { id: "contract", label: "Contract reference" },
  { id: "threat-model", label: "Threat model" },
  { id: "verify", label: "Independent verification" },
];

function SectionHeading({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div className="mb-6 scroll-mt-28" id={id}>
      <span className="text-secondary text-label-sm tracking-widest uppercase">{kicker}</span>
      <h2 className="font-display text-headline-lg mt-2">{title}</h2>
    </div>
  );
}

function FlowNode({
  icon,
  title,
  sub,
  tone,
}: {
  icon: string;
  title: string;
  sub: string;
  tone: "cyan" | "fuchsia" | "neutral";
}) {
  const ring =
    tone === "cyan"
      ? "border-secondary/40 text-secondary"
      : tone === "fuchsia"
        ? "border-primary/40 text-primary"
        : "border-outline-variant/40 text-on-surface-variant";
  return (
    <div
      className={`flex-1 min-w-[140px] bg-surface-container-lowest border rounded-xl p-4 ${ring.split(" ")[0]}`}
    >
      <span className={`material-symbols-outlined text-2xl mb-2 block ${ring.split(" ")[1]}`}>
        {icon}
      </span>
      <div className="font-display text-body-md text-on-surface font-semibold">{title}</div>
      <div className="text-mono-data font-mono text-outline mt-1">{sub}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center shrink-0 text-outline">
      <span className="material-symbols-outlined rotate-90 md:rotate-0">arrow_forward</span>
    </div>
  );
}

export default function HowItWorks() {
  const startDate = HACKATHON_START.toISOString().slice(0, 10);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav active="docs" />
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Hero */}
        <section className="max-w-3xl mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
            <span className="material-symbols-outlined ms-fill text-secondary text-[16px]">
              menu_book
            </span>
            <span className="text-secondary text-label-sm tracking-wider uppercase">
              How Aletheia works
            </span>
          </div>
          <h1 className="font-display text-[32px] leading-[1.1] sm:text-[40px] md:text-headline-xl mb-6">
            From a <span className="text-primary bloom-fuchsia-text">git push</span> to a proof no
            author can rewrite.
          </h1>
          <p className="text-body-md text-on-surface-variant">
            Aletheia (ἀλήθεια, <em>un-concealment</em>) anchors every push to Monad and hands anyone —
            human or judging agent — the means to re-verify the whole record from a fresh clone. This
            page is the full mechanism: the architecture, the contract, and the threat model it was
            designed against.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Sticky table of contents */}
          <aside className="hidden lg:block lg:col-span-3">
            <nav className="sticky top-28">
              <div className="text-label-sm uppercase tracking-widest text-outline mb-4">
                On this page
              </div>
              <ul className="space-y-3 border-l border-outline-variant/30">
                {SECTIONS.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="flex items-center gap-3 -ml-px pl-4 border-l border-transparent hover:border-primary text-on-surface-variant hover:text-primary transition-colors text-body-md"
                    >
                      <span className="font-mono text-mono-data text-outline">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Content */}
          <div className="lg:col-span-9 space-y-20">
            {/* 1. What it proves */}
            <section>
              <SectionHeading id="overview" kicker="The claim, stated honestly" title="What it proves — and what it doesn't" />
              <p className="text-on-surface-variant text-body-md mb-6 max-w-2xl">
                Git history is author-controlled. <code className="text-secondary font-mono">git commit --date</code> and{" "}
                <code className="text-secondary font-mono">GIT_COMMITTER_DATE</code> fabricate any
                timeline after the fact; a force-push rewrites it silently. A block timestamp is
                produced by consensus at a moment in time and cannot be retroactively manufactured.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="material-symbols-outlined ms-fill text-secondary">check_circle</span>
                    <h3 className="font-display text-headline-lg-mobile text-secondary">It proves</h3>
                  </div>
                  <ul className="space-y-3 text-on-surface text-body-md">
                    <li>
                      <strong>Existence by time T</strong> — the attested tree of source existed at or
                      before its block timestamp.
                    </li>
                    <li>
                      <strong>Continuity</strong> — the sequence of attestations shows incremental
                      evolution, not a single late dump.
                    </li>
                  </ul>
                </div>
                <div className="bg-surface-container border border-error/30 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="material-symbols-outlined text-error">cancel</span>
                    <h3 className="font-display text-headline-lg-mobile text-error">
                      It does not prove
                    </h3>
                  </div>
                  <ul className="space-y-3 text-on-surface-variant text-body-md">
                    <li>
                      <strong>Authorship or originality</strong> — someone can attest code they copied.
                      Aletheia proves timing, not who wrote it.
                    </li>
                    <li>We say this plainly in the UI and README rather than overstate the guarantee.</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 2. Architecture */}
            <section>
              <SectionHeading id="architecture" kicker="End to end" title="System architecture" />
              <p className="text-on-surface-variant text-body-md mb-8 max-w-2xl">
                A push flows through an ingestion layer that verifies and forwards it, into a single
                event-sourced contract, and back out to two independent readers — the proof page and
                the verification CLI.
              </p>
              <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-6 mb-6">
                <div className="flex flex-col md:flex-row items-stretch gap-3">
                  <FlowNode icon="commit" title="git push" sub="GitHub repo" tone="neutral" />
                  <Arrow />
                  <FlowNode icon="webhook" title="Ingest" sub="Bridge · HMAC / Action" tone="cyan" />
                  <Arrow />
                  <FlowNode icon="deployed_code" title="attest()" sub="AletheiaRegistry" tone="fuchsia" />
                  <Arrow />
                  <FlowNode icon="account_tree" title="Read" sub="Proof page + CLI" tone="cyan" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    icon: "verified_user",
                    t: "Verify & forward",
                    b: "The bridge checks the X-Hub-Signature-256 HMAC over the raw body, dedupes the delivery ID, resolves the repo to a projectId, and submits attest / attestBatch through a serialized nonce-managed queue.",
                  },
                  {
                    icon: "bolt",
                    t: "Seal on chain",
                    b: "The registry emits one Attested event per commit carrying the commit hash, tree hash, and block.timestamp. Events, not storage — every consumer reads them via eth_getLogs.",
                  },
                  {
                    icon: "fact_check",
                    t: "Read two ways",
                    b: "The proof page renders the timeline from chain events (GitHub metadata is optional garnish). The CLI re-derives the same hashes from a raw clone and compares.",
                  },
                ].map((c) => (
                  <div key={c.t} className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
                    <span className="material-symbols-outlined text-primary text-2xl mb-3 block">{c.icon}</span>
                    <h3 className="font-display text-headline-lg-mobile mb-2">{c.t}</h3>
                    <p className="text-on-surface-variant text-body-md">{c.b}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Why the tree hash */}
            <section>
              <SectionHeading id="tree-hash" kicker="The threat-model core" title="Why the tree hash, not just the commit" />
              <div className="glass-panel rounded-xl p-6 md:p-8">
                <p className="text-on-surface-variant text-body-md mb-4">
                  Attesting only commit hashes admits a cheat: push empty or junk commits on time, then
                  later force-push real content and claim the old hashes. The commit hash does commit to
                  its content — but verifying that requires the original objects, which a force-push can
                  vanish.
                </p>
                <p className="text-on-surface text-body-md mb-6">
                  So Aletheia attests the <span className="text-primary font-semibold">tree hash</span>{" "}
                  alongside the commit. Verification recomputes both from the public repo:
                </p>
                <div className="bg-black/40 border border-outline-variant/30 rounded-lg p-4 font-mono text-mono-data mb-6">
                  <div className="text-secondary">$ git rev-parse &lt;commit&gt;^&#123;tree&#125;</div>
                  <div className="text-outline mt-1"># must reproduce the attested tree hash, byte for byte</div>
                </div>
                <p className="text-on-surface-variant text-body-md">
                  If the repo&apos;s current objects don&apos;t reproduce the attested pair, verification
                  fails visibly. A cheater would need a pre-image of the attested tree hash that matches
                  their later-written code — computationally infeasible. Git SHA-1 ids are 20 bytes,
                  left-aligned and zero-padded into <code className="text-secondary">bytes32</code>;
                  SHA-256 repos fill all 32, and the CLI detects which encoding a repo uses.
                </p>
              </div>
            </section>

            {/* 4. Two paths */}
            <section>
              <SectionHeading id="paths" kicker="Trust, minimized" title="Two attestation paths" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-secondary">dns</span>
                    <h3 className="font-display text-headline-lg-mobile">Hosted bridge</h3>
                  </div>
                  <p className="text-on-surface-variant text-body-md mb-4">
                    A GitHub webhook hits a Fastify service that verifies the HMAC, dedupes replays,
                    and submits with a low-privilege attestor key. Fastest to set up — one webhook URL
                    and secret pasted into repo settings.
                  </p>
                  <span className="text-label-sm uppercase tracking-widest text-outline">
                    Convenience · you trust the bridge&apos;s uptime
                  </span>
                </div>
                <div className="glass-panel rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined ms-fill text-primary">shield_lock</span>
                    <h3 className="font-display text-headline-lg-mobile">Trustless GitHub Action</h3>
                  </div>
                  <p className="text-on-surface-variant text-body-md mb-4">
                    A published workflow lets a project attest its own pushes with its own key, writing
                    to the same contract with the same semantics. No one has to trust Aletheia&apos;s
                    server at all.
                  </p>
                  <span className="text-label-sm uppercase tracking-widest text-primary">
                    Zero third-party trust
                  </span>
                </div>
              </div>
              <p className="text-on-surface-variant text-body-md mt-6">
                Both paths still attest a force-push (the new head is real content at a real time) but
                mark it as a rewrite on the timeline — honesty includes showing rewrites.
              </p>
            </section>

            {/* 5. Contract reference */}
            <section>
              <SectionHeading id="contract" kicker="AletheiaRegistry.sol" title="Contract reference" />
              <p className="text-on-surface-variant text-body-md mb-6 max-w-2xl">
                A single, event-sourced contract. Storage holds only per-project control state; all
                commit data lives in events, which are far cheaper and are what every reader consumes.
              </p>

              <h3 className="font-display text-headline-lg-mobile mb-3">State-changing functions</h3>
              <div className="space-y-3 mb-8">
                {[
                  {
                    sig: "registerProject(bytes32 repoHash, string repoUrl, address attestor)",
                    note: "One project per repo — reverts RepoAlreadyRegistered. repoUrl travels only in the event.",
                  },
                  {
                    sig: "attest(uint256 projectId, bytes32 commitHash, bytes32 treeHash)",
                    note: "Attestor-only, unsealed-only. Emits one Attested with block.timestamp.",
                  },
                  {
                    sig: "attestBatch(uint256 projectId, bytes32[] commitHashes, bytes32[] treeHashes)",
                    note: "Multi-commit pushes. Array lengths must match and be non-empty (BadInput).",
                  },
                  {
                    sig: "linkContract(uint256 projectId, address deployed, string label)",
                    note: "Owner-only. Binds a deployed contract into the build timeline.",
                  },
                  {
                    sig: "setAttestor(uint256 projectId, address newAttestor)",
                    note: "Owner-only. Rotates the attestor key if the bridge key is compromised.",
                  },
                  {
                    sig: "seal(uint256 projectId)",
                    note: "Owner-only, idempotence-guarded. After sealing, every mutating call reverts forever.",
                  },
                ].map((f) => (
                  <div key={f.sig} className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg p-4">
                    <code className="font-mono text-mono-data text-primary break-all">{f.sig}</code>
                    <p className="text-on-surface-variant text-body-md mt-2">{f.note}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-display text-headline-lg-mobile mb-3">Events</h3>
                  <div className="bg-black/40 border border-outline-variant/30 rounded-lg p-4 font-mono text-mono-data text-on-surface-variant space-y-2">
                    <div className="text-secondary break-all">ProjectRegistered(id, owner, attestor, repoHash, repoUrl, ts)</div>
                    <div className="text-primary break-all">Attested(id, commitHash, treeHash, ts)</div>
                    <div className="break-all">ContractLinked(id, deployed, label, ts)</div>
                    <div className="break-all">AttestorChanged(id, newAttestor)</div>
                    <div className="break-all">Sealed(id, ts)</div>
                  </div>
                </div>
                <div>
                  <h3 className="font-display text-headline-lg-mobile mb-3">Errors</h3>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "RepoAlreadyRegistered",
                      "UnknownProject",
                      "NotOwner",
                      "NotAttestor",
                      "ProjectSealed",
                      "BadInput",
                    ].map((e) => (
                      <span
                        key={e}
                        className="font-mono text-mono-data text-error bg-error-container/20 border border-error/30 rounded px-2 py-1"
                      >
                        {e}()
                      </span>
                    ))}
                  </div>
                  <p className="text-outline text-mono-data font-mono mt-4">
                    Deployed on {CHAIN_NAME} · chain {CHAIN_ID}
                  </p>
                </div>
              </div>
            </section>

            {/* 6. Threat model */}
            <section>
              <SectionHeading id="threat-model" kicker="What it defends against" title="Threat model" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel rounded-xl p-6">
                  <h3 className="font-display text-headline-lg-mobile text-secondary mb-4">Covered</h3>
                  <ul className="space-y-3">
                    {[
                      ["Forged commit dates", "chain timestamp wins"],
                      ["Post-hoc history rewrite", "missing commits flagged by the CLI"],
                      ["Content substitution", "tree-hash mismatch"],
                      ["Junk-commit-then-replace", "tree-hash pre-image infeasibility"],
                      ["Post-submission additions", "sealing closes the record"],
                      ["Bridge key theft", "low-privilege, rotatable; worst case is spurious attestations, never fund loss"],
                      ["Webhook forgery / replay", "HMAC + delivery-ID dedupe"],
                    ].map(([t, d]) => (
                      <li key={t} className="flex items-start gap-3 text-on-surface text-body-md">
                        <span className="material-symbols-outlined ms-fill text-secondary text-[18px] mt-0.5 shrink-0">
                          shield
                        </span>
                        <span>
                          <strong>{t}</strong> — {d}.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6">
                  <h3 className="font-display text-headline-lg-mobile text-on-surface-variant mb-4">
                    Out of scope, stated honestly
                  </h3>
                  <ul className="space-y-3">
                    {[
                      ["Proving authorship", "someone can attest code they copied — timing, not originality"],
                      ["Pre-writing code before registering", "mitigated socially; the timeline's shape during the event is the signal judges read"],
                      ["GitHub lying about tree contents", "defeated by independent CLI recomputation from a raw clone"],
                    ].map(([t, d]) => (
                      <li key={t} className="flex items-start gap-3 text-on-surface-variant text-body-md">
                        <span className="material-symbols-outlined text-outline text-[18px] mt-0.5 shrink-0">
                          radio_button_unchecked
                        </span>
                        <span>
                          <strong className="text-on-surface">{t}</strong> — {d}.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* 7. Verification */}
            <section>
              <SectionHeading id="verify" kicker="The judge's tool" title="Independent verification" />
              <p className="text-on-surface-variant text-body-md mb-6 max-w-2xl">
                Anyone re-runs the whole proof with nothing but Node ≥ 20 and a system{" "}
                <code className="text-secondary font-mono">git</code>. No keys, no writes, no trust in
                Aletheia&apos;s servers.
              </p>
              <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden shadow-2xl mb-6">
                <div className="bg-surface-container px-4 py-2 flex items-center gap-2 border-b border-outline-variant/20">
                  <div className="w-3 h-3 rounded-full bg-error/40" />
                  <div className="w-3 h-3 rounded-full bg-primary/40" />
                  <div className="w-3 h-3 rounded-full bg-secondary/40" />
                </div>
                <div className="p-6 font-mono text-mono-data bg-black/40">
                  <div className="text-secondary">$ npx aletheia-verify &lt;projectId&gt;</div>
                  <div className="text-outline mt-2"># reads ProjectRegistered + all Attested events</div>
                  <div className="text-outline"># blobless-clones the repo, recomputes commit + tree pairs</div>
                  <div className="text-outline"># compares against chain, prints a per-commit verdict, exits non-zero on mismatch</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    dot: "bg-secondary",
                    t: "Green — verified",
                    b: "Commit present and its recomputed tree matches the attested hash. An honest repo that never rewrites published history stays all-green and exits 0.",
                  },
                  {
                    dot: "bg-primary",
                    t: "Yellow — missing",
                    b: "An attested commit is gone from history — rewritten after attestation. Fails: a tool that passed these would let a rewritten repo look clean.",
                  },
                  {
                    dot: "bg-error",
                    t: "Red — mismatch",
                    b: "A present commit whose recorded tree never matched it. The residual case; also fails and exits non-zero.",
                  },
                ].map((v) => (
                  <div key={v.t} className="bg-surface-container border border-outline-variant/20 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${v.dot}`} />
                      <h3 className="font-display text-body-md font-semibold">{v.t}</h3>
                    </div>
                    <p className="text-on-surface-variant text-body-md">{v.b}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* CTA */}
            <section className="glass-panel rounded-xl p-8 cyber-grid relative overflow-hidden">
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="font-display text-headline-lg mb-2">Read it straight from the chain</h2>
                  <p className="text-on-surface-variant text-body-md max-w-xl">
                    Every proof on this site is reproducible. Verify a repository, browse the registry,
                    or read the source — the record answers to the chain, not to us. Hackathon clock
                    starts {startDate}.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                  <Link
                    href="/verify"
                    className="bg-primary-container text-on-primary-container px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:brightness-110 active:scale-95 transition-all bloom-primary"
                  >
                    Verify a repo
                  </Link>
                  <a
                    href={`${EXPLORER_URL}`}
                    className="border border-outline-variant/40 text-on-surface px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:border-primary/50 transition-all"
                  >
                    Open explorer
                  </a>
                  <a
                    href={REPO_URL}
                    className="border border-outline-variant/40 text-on-surface px-6 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:border-primary/50 transition-all"
                  >
                    Source
                  </a>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

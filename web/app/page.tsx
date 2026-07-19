import Link from "next/link";
import RegisterFlow from "../components/RegisterFlow";
import { SiteFooter, TopNav } from "../components/Chrome";
import {
  CHAIN_NAME,
  CHAIN_ID,
  EXPLORER_URL,
  REGISTRY_ADDRESS,
  RPC_URL,
  explorerAddress,
  publicClient,
  registryAbi,
} from "../lib/chain";
import { fetchRecentProjects } from "../lib/indexer";

// Rendered at request time: recent projects and counts are live chain state.
export const dynamic = "force-dynamic";

const ATTESTOR_ADDRESS = process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS ?? "";
const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? "";

const ICONS = ["terminal", "memory", "account_balance", "hub", "dns", "code"];

function repoName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

export default async function Landing() {
  const [recent, projectCount] = await Promise.all([
    fetchRecentProjects().catch(() => []),
    publicClient
      .readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: "projectCount" })
      .catch(() => 0n),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="pt-32 pb-20 flex-grow">
        {/* Hero */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mb-24 relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
              <span className="material-symbols-outlined ms-fill text-secondary text-[16px]">
                verified
              </span>
              <span className="text-secondary text-label-sm tracking-wider uppercase">
                Live on {CHAIN_NAME} · chain {CHAIN_ID}
              </span>
            </div>
            <h1 className="font-display text-[34px] leading-[1.1] sm:text-[40px] md:text-headline-xl mb-6">
              Proof you built it, <br />
              <span className="text-primary bloom-fuchsia-text">when you said you did.</span>
            </h1>
            <p className="text-body-md text-on-surface-variant mb-10 max-w-xl">
              Git dates can be forged and force-pushes rewrite history silently. Aletheia seals every
              push to Monad — commit hash, tree hash, block timestamp — into a public timeline anyone
              can re-verify from a fresh clone. Trust moves from the author to the chain.
            </p>
            <div id="register" className="max-w-xl scroll-mt-28">
              <RegisterFlow
                registryAddress={REGISTRY_ADDRESS}
                attestorAddress={ATTESTOR_ADDRESS}
                bridgeUrl={BRIDGE_URL}
                chainId={CHAIN_ID}
                rpcUrl={RPC_URL}
                explorerUrl={EXPLORER_URL}
              />
              <p className="mt-3 text-mono-data font-mono text-outline">
                One transaction, then a webhook — every push self-attests from that moment.{" "}
                <a className="text-primary hover:underline" href={explorerAddress(REGISTRY_ADDRESS)}>
                  registry {REGISTRY_ADDRESS.slice(0, 10)}…
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Bento: thesis + live count */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mb-32">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:h-[360px]">
            <div className="md:col-span-8 glass-panel p-8 rounded-xl flex flex-col justify-end relative overflow-hidden cyber-grid">
              <div className="relative z-10">
                <h3 className="font-display text-headline-lg mb-2">Trust on the chain, not the author</h3>
                <p className="text-on-surface-variant max-w-md text-body-md">
                  Every commit is hashed with its tree and anchored to Monad, creating a permanent
                  record of creation that no force-push can rewrite away.
                </p>
              </div>
            </div>
            <div className="md:col-span-4 bg-surface-container-high border border-outline-variant/20 p-8 rounded-xl flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-full bg-secondary-container/20 flex items-center justify-center mb-6 bloom-cyan">
                <span className="material-symbols-outlined ms-fill text-secondary text-4xl">
                  verified_user
                </span>
              </div>
              <div className="font-display text-headline-xl text-secondary mb-1">
                {projectCount.toString()}
              </div>
              <div className="text-label-sm uppercase tracking-widest text-on-surface-variant">
                {projectCount === 1n ? "Repository sealed" : "Repositories sealed"}
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mb-32">
          <div className="mb-12">
            <span className="text-secondary text-label-sm tracking-widest uppercase">
              From clone to proof
            </span>
            <h2 className="font-display text-headline-lg mt-2">Three steps, one transaction</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "app_registration",
                step: "01",
                title: "Register the repo",
                body: "Connect a wallet, paste a GitHub URL, sign one transaction. The registry stores keccak256(github.com/owner/repo) and the attestor key. One project per repo, enforced on-chain.",
              },
              {
                icon: "bolt",
                step: "02",
                title: "Every push self-seals",
                body: "A webhook (or a trustless GitHub Action with your own key) turns each push into an Attested event within ~30 seconds — commit hash, tree hash, block timestamp. Force-pushes are marked, never hidden.",
              },
              {
                icon: "verified_user",
                step: "03",
                title: "Anyone re-verifies",
                body: "npx aletheia-verify <id> clones fresh, recomputes every commit and tree hash, and diffs them against the chain. Exits non-zero on any mismatch. No keys, no trust in our servers.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="bg-surface-container border border-outline-variant/20 rounded-xl p-8 hover:border-primary/40 transition-all"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-2xl">{s.icon}</span>
                  </div>
                  <span className="font-mono text-mono-data text-outline">{s.step}</span>
                </div>
                <h3 className="font-display text-headline-lg-mobile mb-3">{s.title}</h3>
                <p className="text-on-surface-variant text-body-md">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The asymmetry: forgeable Git vs anchored chain */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mb-32">
          <div className="mb-12 max-w-2xl">
            <span className="text-secondary text-label-sm tracking-widest uppercase">
              Why heuristics fail
            </span>
            <h2 className="font-display text-headline-lg mt-2 mb-3">
              A clean-looking history proves nothing
            </h2>
            <p className="text-on-surface-variant text-body-md">
              Cheaters can fabricate an honest-looking timeline; honest builders get flagged by
              guesswork. The record itself has to move somewhere the author can&apos;t rewrite.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface-container border border-error/30 rounded-xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <span className="material-symbols-outlined text-error text-2xl">gpp_bad</span>
                <h3 className="font-display text-headline-lg-mobile text-error">Author-controlled Git</h3>
              </div>
              <ul className="space-y-4">
                {[
                  "git commit --date backdates any commit to any moment",
                  "A force-push silently rewrites the entire history",
                  "Timestamps live in the repo the author fully owns",
                  "Judges fall back on fallible fraud-detection heuristics",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-on-surface-variant text-body-md">
                    <span className="material-symbols-outlined text-error text-[18px] mt-0.5 shrink-0">
                      close
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass-panel rounded-xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <span className="material-symbols-outlined ms-fill text-secondary text-2xl">
                  gpp_good
                </span>
                <h3 className="font-display text-headline-lg-mobile text-secondary">
                  Chain-anchored Aletheia
                </h3>
              </div>
              <ul className="space-y-4">
                {[
                  "Block timestamps are set by the network, not the pusher",
                  "A rewrite still seals at its real time — and is flagged",
                  "The timeline lives on Monad, outside the author's reach",
                  "Judges get a verification endpoint instead of guesswork",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-on-surface text-body-md">
                    <span className="material-symbols-outlined ms-fill text-secondary text-[18px] mt-0.5 shrink-0">
                      check
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What a judging agent can verify */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mb-32">
          <div className="glass-panel rounded-xl p-8 md:p-12 cyber-grid relative overflow-hidden">
            <div className="relative z-10">
              <div className="mb-10 max-w-2xl">
                <span className="text-secondary text-label-sm tracking-widest uppercase">
                  Built for the judge on the other side
                </span>
                <h2 className="font-display text-headline-lg mt-2 mb-3">
                  Every fraud check, answered from the chain
                </h2>
                <p className="text-on-surface-variant text-body-md">
                  Automated judging asks three questions. Aletheia turns each one from a heuristic
                  guess into a lookup anyone can reproduce.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  {
                    icon: "schedule",
                    q: "Did it start in-window?",
                    a: "The first Attested event carries a block timestamp — an offset from the hackathon start no backdated commit can fake.",
                  },
                  {
                    icon: "database",
                    q: "Is the demo real work?",
                    a: "A commit-by-commit timeline of tree hashes shows the project evolving, not a single dump of placeholder data.",
                  },
                  {
                    icon: "history",
                    q: "Are the commits suspicious?",
                    a: "Force-pushes are surfaced as rewrite markers on the timeline. Nothing is hidden; the record shows exactly what happened.",
                  },
                ].map((c) => (
                  <div key={c.q}>
                    <div className="w-12 h-12 rounded-full bg-secondary-container/20 flex items-center justify-center mb-5 bloom-cyan">
                      <span className="material-symbols-outlined text-secondary text-2xl">
                        {c.icon}
                      </span>
                    </div>
                    <h3 className="font-display text-headline-lg-mobile mb-2">{c.q}</h3>
                    <p className="text-on-surface-variant text-body-md">{c.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Recent proofs */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="font-display text-headline-lg mb-2">Recent proofs</h2>
              <p className="text-on-surface-variant text-body-md">
                Live stream of registered repositories, straight from the chain.
              </p>
            </div>
            <a
              href={explorerAddress(REGISTRY_ADDRESS)}
              className="hidden md:flex items-center gap-2 text-primary text-label-sm uppercase hover:underline"
            >
              View on explorer
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            </a>
          </div>
          {recent.length === 0 ? (
            <div className="glass-panel rounded-xl p-10 text-center text-on-surface-variant">
              No projects registered yet. Be the first — register your repository above.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {recent.map((p, i) => (
                <Link
                  key={p.projectId}
                  href={`/p/${p.projectId}`}
                  className="glass-panel p-6 rounded-xl hover:-translate-y-1 transition-all duration-300 block"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-12 h-12 bg-surface-variant rounded flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-2xl">
                        {ICONS[i % ICONS.length]}
                      </span>
                    </div>
                    <span className="px-3 py-1 bg-secondary-container/10 border border-secondary-container/30 text-secondary-container text-label-sm rounded uppercase flex items-center gap-1">
                      <span className="material-symbols-outlined ms-fill text-[14px]">
                        check_circle
                      </span>
                      Attested
                    </span>
                  </div>
                  <h4 className="font-display text-headline-lg-mobile mb-2 truncate">
                    {repoName(p.repoUrl)}
                  </h4>
                  <p className="text-on-surface-variant text-body-md mb-6">
                    Registered {new Date(p.timestamp * 1000).toISOString().slice(0, 10)}.
                  </p>
                  <div className="pt-6 border-t border-outline-variant/20 flex justify-between items-center">
                    <span className="font-mono text-mono-data text-outline">
                      project #{p.projectId}
                    </span>
                    <span className="font-mono text-mono-data text-primary">
                      {p.owner.slice(0, 6)}…{p.owner.slice(-4)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* FAQ */}
        <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop mt-32">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
            <div className="md:col-span-4">
              <span className="text-secondary text-label-sm tracking-widest uppercase">
                The honest small print
              </span>
              <h2 className="font-display text-headline-lg mt-2 mb-4">Questions worth asking</h2>
              <p className="text-on-surface-variant text-body-md">
                Aletheia claims exactly what the chain can back — and nothing more.
              </p>
            </div>
            <div className="md:col-span-8 space-y-3">
              {[
                {
                  q: "Does this prove I wrote the code?",
                  a: "No. Aletheia proves timing and continuity — when a repository existed and how it evolved — not authorship or originality. We say so in the UI and the README rather than overstate it.",
                },
                {
                  q: "What happens if I force-push?",
                  a: "The rewrite is sealed at its real block time and marked on the timeline as a rewrite. Nothing is hidden — a reviewer sees exactly that history was rewritten and when.",
                },
                {
                  q: "Do I have to trust Aletheia's servers?",
                  a: "No. The record lives on Monad, and npx aletheia-verify re-derives every commit and tree hash from a fresh clone, comparing against on-chain events with nothing but Node and git.",
                },
                {
                  q: "What if the webhook bridge is down?",
                  a: "A published GitHub Action lets a project attest its own pushes with its own key, bypassing the bridge entirely. The trustless path never depends on our infrastructure.",
                },
                {
                  q: "Can I attest commits from before I registered?",
                  a: "By design, no. Aletheia only ever attests the present — the push happening now. Back-dating attestations would reintroduce exactly the forgery it exists to prevent.",
                },
                {
                  q: "Which chain, and what does it cost?",
                  a: `${CHAIN_NAME} (chain ${CHAIN_ID}). Registration is a single transaction; each push is one attestation. No token, no payment.`,
                },
              ].map((f) => (
                <details
                  key={f.q}
                  className="group bg-surface-container border border-outline-variant/20 rounded-xl px-6 open:border-primary/40 transition-colors"
                >
                  <summary className="flex items-center justify-between gap-4 cursor-pointer list-none py-5">
                    <span className="font-display text-headline-lg-mobile text-on-surface">{f.q}</span>
                    <span className="material-symbols-outlined text-primary transition-transform group-open:rotate-45 shrink-0">
                      add
                    </span>
                  </summary>
                  <p className="text-on-surface-variant text-body-md pb-5 -mt-1 max-w-2xl">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

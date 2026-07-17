import Link from "next/link";
import RegisterFlow from "../components/RegisterFlow";
import { SiteFooter, TopNav } from "../components/Chrome";
import {
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
                Live on Monad testnet · chain {CHAIN_ID}
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
      </main>
      <SiteFooter />
    </div>
  );
}

import Link from "next/link";
import RegisterFlow from "../components/RegisterFlow";
import { CHAIN_ID, EXPLORER_URL, REGISTRY_ADDRESS, RPC_URL, explorerAddress } from "../lib/chain";
import { fetchRecentProjects } from "../lib/indexer";

// Rendered at request time: the recent-projects list comes from live chain
// state, which does not exist at build time.
export const dynamic = "force-dynamic";

const ATTESTOR_ADDRESS = process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS ?? "";
const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? "";

export default async function Landing() {
  let recent: Awaited<ReturnType<typeof fetchRecentProjects>> = [];
  try {
    recent = await fetchRecentProjects();
  } catch {
    // chain hiccup — landing still renders; proof pages remain canonical
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-20">
      <header className="text-center mb-14">
        <p className="font-display text-oxblood text-xl tracking-[0.35em] uppercase">Aletheia</p>
        <h1 className="font-display mt-3 text-4xl sm:text-6xl font-semibold leading-tight">
          Proof you built it,
          <br />
          when you said you did.
        </h1>
        <p className="mt-6 text-ink-soft max-w-xl mx-auto leading-relaxed">
          Git history is author-controlled: dates can be forged and force-pushes rewrite the record
          silently. Aletheia binds your repository to a contract on Monad and seals every push —
          commit hash, tree hash, block timestamp — into an immutable public timeline that anyone,
          including a judging agent, can re-verify from a fresh clone. Trust moves from the author
          to the chain.
        </p>
      </header>

      <section className="mb-14">
        <h2 className="font-display text-2xl mb-4">Register your repository</h2>
        <RegisterFlow
          registryAddress={REGISTRY_ADDRESS}
          attestorAddress={ATTESTOR_ADDRESS}
          bridgeUrl={BRIDGE_URL}
          chainId={CHAIN_ID}
          rpcUrl={RPC_URL}
          explorerUrl={EXPLORER_URL}
        />
        <p className="mt-3 text-xs text-ink-soft">
          One transaction on Monad testnet ({"chain " + CHAIN_ID}), then a webhook — every push
          self-attests from that moment. Registry:{" "}
          <a className="underline" href={explorerAddress(REGISTRY_ADDRESS)}>
            {REGISTRY_ADDRESS.slice(0, 10)}…
          </a>
        </p>
      </section>

      <section>
        <h2 className="font-display text-2xl mb-4">Recently registered</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-soft">No projects yet — be the first.</p>
        ) : (
          <ul className="divide-y divide-line border border-line bg-white/40">
            {recent.map((p) => (
              <li key={p.projectId}>
                <Link
                  href={`/p/${p.projectId}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-parchment"
                >
                  <span className="font-display text-lg text-oxblood shrink-0">
                    #{p.projectId}
                  </span>
                  <span className="truncate text-sm flex-1">
                    {p.repoUrl.replace(/^https?:\/\//, "")}
                  </span>
                  <span className="text-xs text-ink-soft shrink-0">
                    {new Date(p.timestamp * 1000).toISOString().slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 text-center text-xs text-ink-soft space-x-4">
        <a className="underline" href="https://github.com/pextacy/aletheia">
          source
        </a>
        <span>·</span>
        <a className="underline" href={EXPLORER_URL}>
          explorer
        </a>
        <span>·</span>
        <span>proves timing, not authorship — stated honestly</span>
      </footer>
    </main>
  );
}

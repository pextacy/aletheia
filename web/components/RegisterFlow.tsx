"use client";

import { useState } from "react";
import {
  createWalletClient,
  custom,
  keccak256,
  parseAbi,
  toBytes,
  type Hex,
} from "viem";

const registerAbi = parseAbi([
  "function registerProject(bytes32 repoHash, string repoUrl, address attestor) external returns (uint256)",
  "function projectByRepo(bytes32 repoHash) view returns (uint256)",
  // Errors must be in the ABI for viem to decode a revert to its name.
  "error RepoAlreadyRegistered()",
  "error BadInput()",
]);

interface Props {
  registryAddress: string;
  attestorAddress: string;
  bridgeUrl: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
}

type Step =
  | { s: "idle" }
  | { s: "working"; msg: string }
  | { s: "done"; projectId: number; secret: string; secretRegistered: boolean }
  | { s: "error"; msg: string };

function canonicalRepoPath(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(github\.com\/[^/]+\/[^/#?]+?)(?:\.git)?\/?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 border border-outline-variant/40 rounded px-2 py-0.5 text-[11px] uppercase tracking-wider text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

export default function RegisterFlow(props: Props) {
  const [repoUrl, setRepoUrl] = useState("");
  const [step, setStep] = useState<Step>({ s: "idle" });

  async function register() {
    const path = canonicalRepoPath(repoUrl);
    if (!path) {
      setStep({ s: "error", msg: "Enter a GitHub repository URL like https://github.com/you/repo" });
      return;
    }
    const eth = (window as { ethereum?: unknown }).ethereum;
    if (!eth) {
      setStep({ s: "error", msg: "No wallet found. Install MetaMask or another injected wallet." });
      return;
    }
    try {
      setStep({ s: "working", msg: "Connecting wallet…" });
      const wallet = createWalletClient({ transport: custom(eth as never) });
      const [account] = await wallet.requestAddresses();
      if (!account) throw new Error("wallet returned no account");

      const currentChain = await wallet.getChainId();
      if (currentChain !== props.chainId) {
        setStep({ s: "working", msg: "Switching to Monad testnet…" });
        try {
          await wallet.switchChain({ id: props.chainId });
        } catch {
          await wallet.addChain({
            chain: {
              id: props.chainId,
              name: "Monad Testnet",
              nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
              rpcUrls: { default: { http: [props.rpcUrl] } },
              blockExplorers: { default: { name: "Monad Explorer", url: props.explorerUrl } },
            },
          });
          await wallet.switchChain({ id: props.chainId });
        }
      }

      const repoHash = keccak256(toBytes(path));
      setStep({ s: "working", msg: "Confirm the registration transaction in your wallet…" });
      const txHash = await wallet.writeContract({
        account,
        chain: null,
        address: props.registryAddress as Hex,
        abi: registerAbi,
        functionName: "registerProject",
        args: [repoHash, `https://${path}`, props.attestorAddress as Hex],
      });

      setStep({ s: "working", msg: `Waiting for confirmation… (${txHash.slice(0, 10)}…)` });
      // poll projectByRepo until the registration lands
      const { createPublicClient, http: httpTransport } = await import("viem");
      const pub = createPublicClient({ transport: httpTransport(props.rpcUrl) });
      let projectId = 0n;
      for (let i = 0; i < 60 && projectId === 0n; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        projectId = await pub.readContract({
          address: props.registryAddress as Hex,
          abi: registerAbi,
          functionName: "projectByRepo",
          args: [repoHash],
        });
      }
      if (projectId === 0n) throw new Error("registration not visible on chain after 2 minutes");

      // per-project webhook secret, bound to the owner key by signature
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, "0")).join("");

      setStep({ s: "working", msg: "Sign the webhook secret binding (no gas)…" });
      let secretRegistered = false;
      try {
        const signature = await wallet.signMessage({
          account,
          message: `aletheia-webhook-secret:${projectId}:${secret}`,
        });
        const res = await fetch(`${props.bridgeUrl}/webhook/register-secret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: Number(projectId), secret, signature, chainId: props.chainId }),
        });
        secretRegistered = res.ok;
      } catch {
        secretRegistered = false;
      }

      setStep({ s: "done", projectId: Number(projectId), secret, secretRegistered });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // viem decodes the revert to the error name when it is in the ABI; the raw
      // selector 0xa525bbac is matched too as a belt-and-braces fallback.
      const msg = /RepoAlreadyRegistered|0xa525bbac/i.test(raw)
        ? "This repository is already registered — one project per repo, enforced on-chain."
        : raw.split("\n")[0]!;
      setStep({ s: "error", msg });
    }
  }

  if (step.s === "done") {
    const webhookUrl = `${props.bridgeUrl}/webhook/github`;
    const rows: Array<{ label: string; value: string; copy?: boolean }> = [
      { label: "Payload URL", value: webhookUrl, copy: true },
      { label: "Content type", value: "application/json" },
      { label: "Secret", value: step.secret, copy: true },
      { label: "Events", value: "Just the push event" },
    ];
    return (
      <div className="glass-panel rounded-xl p-6 space-y-5 border border-primary-container/40 bloom-primary">
        <p className="font-display text-headline-lg-mobile">
          Registered as project{" "}
          <span className="text-primary bloom-fuchsia-text">#{step.projectId}</span>
        </p>
        <p className="text-body-md text-on-surface-variant">
          Add the webhook to your repo:{" "}
          <span className="text-secondary">Settings → Webhooks → Add webhook</span>
        </p>
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center gap-3 bg-background rounded-lg px-4 py-2.5 border border-outline-variant/20"
            >
              <span className="w-28 shrink-0 text-label-sm uppercase tracking-wider text-outline">
                {r.label}
              </span>
              <code className="flex-1 min-w-0 truncate font-mono text-mono-data text-on-surface">
                {r.value}
              </code>
              {r.copy && <CopyButton value={r.value} />}
            </div>
          ))}
        </div>
        {!step.secretRegistered && (
          <p className="text-body-md text-error bg-error-container/20 border border-error/40 rounded-lg px-4 py-3">
            The bridge did not accept the secret binding, so pushes will be rejected. Keep the secret
            and try again, or run your own attestor with the GitHub Action instead.
          </p>
        )}
        <p className="text-body-md text-on-surface-variant">
          The secret is shown once — save it in your webhook settings now. Open your proof page:{" "}
          <a className="text-primary underline" href={`/p/${step.projectId}`}>
            /p/{step.projectId}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="glass-panel p-1 rounded-xl group focus-within:border-primary transition-colors">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex-1 flex items-center bg-background px-4 py-3 rounded-lg border border-transparent group-focus-within:border-primary/20">
            <span className="material-symbols-outlined text-outline mr-3">link</span>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="github.com/you/your-project"
              className="bg-transparent border-none focus:ring-0 focus:outline-none w-full font-mono text-mono-data text-on-surface placeholder:text-outline-variant"
            />
          </div>
          <button
            type="button"
            onClick={() => void register()}
            disabled={step.s === "working"}
            className="bg-primary-container text-on-primary-container text-label-sm uppercase tracking-widest px-8 py-3 rounded-lg flex items-center justify-center gap-2 bloom-fuchsia hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          >
            {step.s === "working" ? "Working…" : "Connect repository"}
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </div>
      {step.s === "working" && (
        <p className="text-mono-data font-mono text-secondary">{step.msg}</p>
      )}
      {step.s === "error" && (
        <p className="text-mono-data font-mono text-error">{step.msg}</p>
      )}
    </div>
  );
}

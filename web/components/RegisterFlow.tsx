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
      className="shrink-0 border border-line px-2 py-0.5 text-xs hover:border-oxblood hover:text-oxblood"
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
          body: JSON.stringify({ projectId: Number(projectId), secret, signature }),
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
    return (
      <div className="border border-oxblood bg-white/40 p-6 space-y-4">
        <p className="font-display text-2xl">
          Registered as project <span className="text-oxblood">#{step.projectId}</span>
        </p>
        <p className="text-sm">
          Now add a webhook in your repo:{" "}
          <span className="text-ink-soft">Settings → Webhooks → Add webhook</span>
        </p>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-ink-soft">Payload URL</span>
            <code className="truncate">{webhookUrl}</code>
            <CopyButton value={webhookUrl} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-ink-soft">Content type</span>
            <code>application/json</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-ink-soft">Secret</span>
            <code className="truncate">{step.secret}</code>
            <CopyButton value={step.secret} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-ink-soft">Events</span>
            <code>Just the push event</code>
          </div>
        </div>
        {!step.secretRegistered && (
          <p className="text-sm text-oxblood">
            Warning: the bridge did not accept the secret binding — pushes will be rejected until it
            does. Keep the secret and retry from this page, or run your own attestor via the GitHub
            Action instead.
          </p>
        )}
        <p className="text-sm">
          This secret is shown once — store it in your webhook settings now. Your proof page:{" "}
          <a className="underline text-oxblood" href={`/p/${step.projectId}`}>
            /p/{step.projectId}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/you/your-project"
          className="flex-1 border border-line bg-white/60 px-4 py-3 text-sm outline-none
                     focus:border-oxblood placeholder:text-ink-soft/60"
        />
        <button
          type="button"
          onClick={() => void register()}
          disabled={step.s === "working"}
          className="bg-oxblood text-parchment px-6 py-3 text-sm font-medium
                     hover:bg-oxblood-dark disabled:opacity-50"
        >
          {step.s === "working" ? "Working…" : "Register on-chain"}
        </button>
      </div>
      {step.s === "working" && <p className="text-sm text-ink-soft">{step.msg}</p>}
      {step.s === "error" && <p className="text-sm text-oxblood">{step.msg}</p>}
    </div>
  );
}

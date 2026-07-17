import Link from "next/link";
import { EXPLORER_URL } from "../lib/chain";

const REPO_URL = "https://github.com/pextacy/aletheia";

export function TopNav({ active }: { active?: "proofs" | "verify" | "projects" }) {
  return (
    <nav className="fixed top-0 w-full z-50 bg-surface-container-low/80 backdrop-blur-xl border-b border-outline-variant/20 shadow-[0_0_20px_rgba(255,13,245,0.1)]">
      <div className="flex justify-between items-center px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
        <Link
          href="/"
          className="font-display text-headline-lg-mobile font-bold tracking-tighter text-primary"
        >
          Aletheia
        </Link>
        <div className="hidden md:flex gap-8 items-center">
          <Link
            href="/"
            className={
              active === "proofs"
                ? "text-primary font-bold border-b-2 border-primary pb-1 text-body-md"
                : "text-on-surface-variant hover:text-primary transition-colors text-body-md"
            }
          >
            Proofs
          </Link>
          <Link
            href="/projects"
            className={
              active === "projects"
                ? "text-primary font-bold border-b-2 border-primary pb-1 text-body-md"
                : "text-on-surface-variant hover:text-primary transition-colors text-body-md"
            }
          >
            Projects
          </Link>
          <Link
            href="/verify"
            className={
              active === "verify"
                ? "text-primary font-bold border-b-2 border-primary pb-1 text-body-md"
                : "text-on-surface-variant hover:text-primary transition-colors text-body-md"
            }
          >
            Verify
          </Link>
          <a
            href={EXPLORER_URL}
            className="text-on-surface-variant hover:text-primary transition-colors text-body-md"
          >
            Explorer
          </a>
          <a
            href={REPO_URL}
            className="text-on-surface-variant hover:text-primary transition-colors text-body-md"
          >
            Docs
          </a>
        </div>
        <a
          href="/#register"
          className="bg-primary-container text-on-primary-container px-6 py-2 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all bloom-primary"
        >
          Register repo
        </a>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="w-full mt-auto bg-surface-container-lowest border-t border-outline-variant/10">
      <div className="flex flex-col md:flex-row justify-between items-center gap-6 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto py-8">
        <div className="font-display text-headline-lg font-black text-on-surface">Aletheia</div>
        <div className="flex flex-wrap gap-6 md:gap-8 justify-center">
          <a
            href={REPO_URL}
            className="text-on-surface-variant hover:text-secondary transition-colors text-label-sm"
          >
            Source
          </a>
          <a
            href={EXPLORER_URL}
            className="text-on-surface-variant hover:text-secondary transition-colors text-label-sm"
          >
            Explorer
          </a>
          <span className="text-on-surface-variant text-label-sm opacity-60">
            Proves timing, not authorship
          </span>
        </div>
        <div className="text-on-surface-variant text-label-sm opacity-40">
          Sealed on Monad testnet
        </div>
      </div>
    </footer>
  );
}

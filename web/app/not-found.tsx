import Link from "next/link";
import { SiteFooter, TopNav } from "../components/Chrome";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full flex items-center">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-variant/30 border border-outline-variant/30 rounded-full mb-6">
            <span className="material-symbols-outlined text-secondary text-[16px]">travel_explore</span>
            <span className="text-secondary text-label-sm tracking-wider uppercase">404 · not found</span>
          </div>
          <h1 className="font-display text-[40px] leading-[1.1] md:text-headline-xl mb-6">
            Nothing sealed <span className="text-primary bloom-fuchsia-text">at this address.</span>
          </h1>
          <p className="text-body-md text-on-surface-variant mb-10">
            The page or project you were looking for isn&apos;t on the chain. Browse the registry or
            look up a repository by its URL.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/projects"
              className="bg-primary-container text-on-primary-container px-8 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:brightness-110 active:scale-95 transition-all bloom-primary"
            >
              Browse projects
            </Link>
            <Link
              href="/verify"
              className="border border-outline-variant/40 text-on-surface px-8 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:border-primary/50 transition-all"
            >
              Verify a repository
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

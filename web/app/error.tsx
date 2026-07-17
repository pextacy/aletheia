"use client";

import { useEffect } from "react";

// Self-contained: an error boundary is a client component, so it must not import
// server-only chrome (which pulls node:fs via lib/chain into the client bundle).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="fixed top-0 w-full z-50 bg-surface-container-low/80 backdrop-blur-xl border-b border-outline-variant/20">
        <div className="flex items-center px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          <a href="/" className="font-display text-headline-lg-mobile font-bold tracking-tighter text-primary">
            Aletheia
          </a>
        </div>
      </nav>
      <main className="flex-grow pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full flex items-center">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-error-container/20 border border-error/40 rounded-full mb-6">
            <span className="material-symbols-outlined text-error text-[16px]">error</span>
            <span className="text-error text-label-sm tracking-wider uppercase">Something broke</span>
          </div>
          <h1 className="font-display text-[40px] leading-[1.1] md:text-headline-xl mb-6">
            The chain read <span className="text-error">didn&apos;t complete.</span>
          </h1>
          <p className="text-body-md text-on-surface-variant mb-4">
            This page renders from live chain data, and that request failed — often a transient RPC
            hiccup. The registry on the block explorer remains the source of truth.
          </p>
          {error.digest && (
            <p className="text-mono-data font-mono text-outline mb-8">ref: {error.digest}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              type="button"
              onClick={reset}
              className="bg-primary-container text-on-primary-container px-8 py-3 rounded-lg text-label-sm uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all bloom-primary"
            >
              Try again
            </button>
            <a
              href="/"
              className="border border-outline-variant/40 text-on-surface px-8 py-3 rounded-lg text-label-sm uppercase tracking-widest text-center hover:border-primary/50 transition-all"
            >
              Back to home
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

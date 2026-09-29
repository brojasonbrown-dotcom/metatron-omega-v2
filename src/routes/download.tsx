import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/download')({
  component: DownloadPage,
  head: () => ({
    meta: [
      { title: 'Download — Metatron V11 Native Engine' },
      {
        name: 'description',
        content:
          'Native engine roadmap for the RHUFT runtime. Local-only, measurement-first, and currently in build.',
      },
      { property: 'og:title', content: 'Download — Metatron V11 Native Engine' },
      {
        property: 'og:description',
        content:
          'The runtime remains local and reports only measured node, frequency, and hardware limits.',
      },
    ],
  }),
});

function DownloadPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 border-b border-border pb-6">
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← back to dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Native Engine — coming next phase
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The browser fallback reports its measured ceiling from the live worker pool. Native
            builds are planned to expose stronger local compute without changing the honesty
            contract.
          </p>
        </header>

        <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card title="macOS" detail="Apple Silicon · Metal compute · NEON" status="phase 8" />
          <Card title="Windows" detail="DX12 / Vulkan via wgpu · AVX-512" status="phase 8" />
          <Card title="Linux" detail="Vulkan via wgpu · AVX-512 · CUDA opt-in" status="phase 8" />
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground">What unlocks</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>• Hardware-scaled M from measured RAM, precision, and tick budget</li>
            <li>• Live driver bank with explicit empirical vs synthetic labels</li>
            <li>• GPU evolution kernel for Ψ_lattice, Ψ_memory, Ψ_closure when available</li>
            <li>• Constant verification separate from performance claims</li>
            <li>• Local-only — your data never leaves the machine</li>
          </ul>
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          Until then, this web app runs the browser fallback engine and shows its actual live
          ceiling in the Governor panels.
        </p>
      </div>
    </div>
  );
}

function Card({ title, detail, status }: { title: string; detail: string; status: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">{status}</p>
    </div>
  );
}

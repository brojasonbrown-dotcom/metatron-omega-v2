import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';

/**
 * Metatron Omega — the cleaned shell. Engines removed; memory archive,
 * tools and Kokoro remain.
 */
const Omega = lazy(() =>
  import('@/ui/omega/OmegaWorkstation').then((m) => ({
    default: m.OmegaWorkstation as ComponentType,
  })),
);

function ClientMount() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-[11px] font-mono tracking-[0.3em] text-muted-foreground">
          METATRON OMEGA · INITIALISING…
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <Omega />
    </Suspense>
  );
}

export const Route = createFileRoute('/')({
  component: ClientMount,
  head: () => ({
    meta: [
      { title: 'Metatron Omega — Memory Archive & Tooling Workstation' },
      {
        name: 'description',
        content:
          'Metatron Omega workstation: archived memory substrate, tool catalog, integrations, run log and Kokoro TTS — engine slot open for the new Omega engine.',
      },
      { property: 'og:title', content: 'Metatron Omega' },
      {
        property: 'og:description',
        content:
          'Archived memory substrate, tools, integrations and Kokoro TTS in a clean Metatron Omega shell.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
});

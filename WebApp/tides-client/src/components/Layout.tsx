import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * Sits to the left of the title on wide screens only. Anything put here needs a place in the
   * body as well for narrow screens, where the header has no room for it.
   */
  headerAside?: ReactNode;
}

export default function Layout({ children, headerAside }: Props) {
  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800 text-white py-4 px-4">
        {/* Three tracks that grow equally, so the title stays centred on the page whatever the
            reading beside it happens to be - and still centres on a phone, where the left track
            is empty and only the version number sits on the right. */}
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <div className="flex flex-1 justify-start">
            {headerAside && <div className="hidden sm:block">{headerAside}</div>}
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold">Captain Crunch's Tide Tracker</h1>
            <p className="text-gray-400 text-sm">🌕🌊🦀🐚🐠🪸🦑🐙🌙🐡🪼🦈🫧🦞🌊☀️</p>
          </div>
          <div className="flex flex-1 justify-end">
            <span className="shrink-0 text-xs text-gray-500 tabular-nums" title={`Version ${__APP_VERSION__}`}>
              v{__APP_VERSION__}
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {children}
      </main>
    </div>
  );
}

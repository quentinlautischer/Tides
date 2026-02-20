import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800 text-white py-4 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-xl font-bold">Captain Crunch's Tide Tracker</h1>
          <p className="text-gray-400 text-sm">🌙🌊🦀🐚🐠🪸🦑🐙🐡🪼🦈🫧🦞🌊☀️</p>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {children}
      </main>
    </div>
  );
}

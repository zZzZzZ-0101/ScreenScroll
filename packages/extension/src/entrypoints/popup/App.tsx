export function App() {
  return (
    <main className="w-80 bg-white p-3 text-[13px] text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <h1 className="mb-3 text-sm font-semibold">ScrollPress</h1>
      <button
        type="button"
        disabled
        className="w-full rounded-md bg-accent px-3 py-2 text-left font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        Capture full page
      </button>
      <p className="mt-2 text-neutral-500">Capture arrives in the next build.</p>
    </main>
  );
}

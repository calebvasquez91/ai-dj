function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const placeholderCards = [
  "Add local files to get started",
  "Build a playlist and let Auto-DJ blend it",
  "Transitions get smoother the more you queue",
];

export default function Home() {
  return (
    <div className="p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold">{greeting()}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Get started</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {placeholderCards.map((text) => (
            <div
              key={text}
              className="rounded-lg bg-surface hover:bg-surface-hover transition-colors p-4 flex items-center gap-4"
            >
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent to-accent-strong shrink-0" />
              <p className="text-sm font-medium">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

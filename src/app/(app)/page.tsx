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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl retro-heading">{greeting()}</h1>
        <div className="retro-stripe w-32" />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-accent-purple">Get started</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {placeholderCards.map((text) => (
            <div
              key={text}
              className="card-retro hover:-translate-y-0.5 transition-transform p-4 flex items-center gap-4"
            >
              <div className="w-14 h-14 rounded-md bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink border-2 border-border shrink-0" />
              <p className="text-sm font-medium">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

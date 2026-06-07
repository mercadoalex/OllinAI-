export function SocialProof() {
  const logos = [
    "Northwind",
    "Acme Cloud",
    "Vertex",
    "Lumen",
    "Quanta",
    "Helios",
  ];

  return (
    <section className="border-b border-border bg-background py-12">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-sm font-medium text-muted-foreground">
          Trusted by platform teams at 50+ companies
        </p>
        <div className="mt-8 grid grid-cols-2 items-center gap-6 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((logo) => (
            <div
              key={logo}
              className="flex items-center justify-center rounded-lg border border-border bg-card/50 px-4 py-3"
            >
              <span className="text-sm font-semibold tracking-wide text-muted-foreground">
                {logo}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

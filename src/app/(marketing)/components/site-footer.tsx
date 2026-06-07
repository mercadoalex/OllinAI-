import Link from "next/link";
import Image from "next/image";

const links = [
  { label: "Documentation", href: "#" },
  { label: "API Reference", href: "#" },
  { label: "Status", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Terms", href: "#" },
];

export function SiteFooter() {
  return (
    <footer className="bg-background py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <Image
            src="/ollin_logo_white.png"
            alt="OllinAI"
            width={100}
            height={28}
            className="dark:hidden"
          />
          <Image
            src="/ollin_logo_black.png"
            alt="OllinAI"
            width={100}
            height={28}
            className="hidden dark:block"
          />
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="text-sm text-muted-foreground">
          &copy; 2024 OllinAI
        </p>
      </div>
    </footer>
  );
}

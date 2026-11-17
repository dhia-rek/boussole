import { ArrowRight, Lock, Search, Sparkles, Target } from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { hasAuthenticatedSession } from "../api/auth-session";
import {
  BoussoleMark,
  BoussoleWordmark,
} from "../components/brand/BoussoleMark";
import { useDemoInfo } from "../hooks/useDemoInfo";
import { BRAND, PUBLIC_DEMO_URL } from "../lib/brand";

export type DemoTarget =
  | { kind: "internal"; to: string }
  | { kind: "external"; href: string }
  | null;

/** Where "Voir la démo" leads: this instance when it is the demo, else the public demo. */
export function resolveDemoTarget(
  demoMode: boolean,
  demoUrl: string | null,
): DemoTarget {
  if (demoMode) return { kind: "internal", to: "/today" };
  if (demoUrl) return { kind: "external", href: demoUrl };
  return null;
}

const CTA_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-periwinkle focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0c24]";
const CTA_CORAL = `${CTA_BASE} bg-brand-coral text-brand-indigo hover:bg-[#ff8370]`;
const CTA_GHOST = `${CTA_BASE} bg-white/10 text-brand-lilac hover:bg-white/15`;

const DemoLink: React.FC<{
  target: DemoTarget;
  className: string;
  children: React.ReactNode;
}> = ({ target, className, children }) => {
  if (!target) return null;
  if (target.kind === "internal") {
    return (
      <Link to={target.to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={target.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
};

const EXAMPLE_MATCHES = [
  {
    title: "Data Quality Analyst",
    meta: "Fintech · Lille · CDI",
    score: 92,
  },
  {
    title: "Ingénieur IA générative",
    meta: "Cabinet de conseil · Paris · CDI",
    score: 88,
  },
  { title: "Data Steward", meta: "Assurance · Nantes · CDI", score: 81 },
];

const PROBLEMS = [
  {
    title: "Des offres éparpillées",
    text: "LinkedIn, Indeed, Welcome to the Jungle, pages carrières… Les bonnes offres sont partout, noyées dans le bruit.",
  },
  {
    title: "Un CV pour tous les postes",
    text: "Le même CV envoyé à cinquante offres ne parle vraiment à aucune.",
  },
  {
    title: "Un deuxième travail",
    text: "Trier, relire, adapter, relancer : la recherche d'emploi dévore vos soirées.",
  },
];

const STEPS = [
  {
    icon: Search,
    title: "Boussole cherche",
    text: "Plus de quinze sites d'emploi, dont Welcome to the Jungle, et les pages carrières de 62 entreprises qui recrutent en France.",
  },
  {
    icon: Target,
    title: "Boussole note",
    text: "Chaque offre reçoit un score de 0 à 100 selon votre CV et vos critères : type de contrat, lieu, séniorité.",
  },
  {
    icon: Sparkles,
    title: "Boussole prépare",
    text: "Pour les meilleures offres, des agents IA rédigent un CV d'une page et une lettre sur mesure. Un agent critique retire tout ce que votre parcours ne prouve pas.",
  },
];

const STACK = [
  "LangChain Deep Agents",
  "Claude",
  "React · TypeScript",
  "Node.js · SQLite",
  "Playwright",
  "LaTeX",
];

function scoreTone(score: number): string {
  if (score >= 90) return "bg-brand-coral text-brand-indigo";
  if (score >= 85) return "bg-brand-periwinkle text-brand-indigo";
  return "bg-white/15 text-brand-lilac";
}

export const LandingPage: React.FC = () => {
  const demoInfo = useDemoInfo();
  const demoTarget = resolveDemoTarget(
    demoInfo?.demoMode === true,
    PUBLIC_DEMO_URL,
  );
  const signedIn = hasAuthenticatedSession();
  const enterLink = signedIn
    ? { to: "/today", label: "Ouvrir Boussole" }
    : { to: "/sign-in", label: "Se connecter" };

  return (
    <div lang="fr" className="min-h-dvh bg-[#0d0c24] text-brand-lilac">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link
          to="/welcome"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-periwinkle"
        >
          <BoussoleMark className="size-9 text-brand-lilac" />
          <BoussoleWordmark className="text-2xl" />
        </Link>
        <nav aria-label="Accès" className="flex items-center gap-2">
          <DemoLink
            target={demoTarget}
            className={cn(CTA_GHOST, "hidden sm:inline-flex")}
          >
            Voir la démo
          </DemoLink>
          <Link to={enterLink.to} className={CTA_CORAL}>
            {enterLink.label}
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(155,147,255,0.28),transparent)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.3fr_0.7fr] lg:pt-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-periwinkle">
                Recherche d'emploi pilotée par l'IA
              </p>
              <h1 className="mt-4 font-display text-[clamp(2.5rem,4.8vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-brand-lilac">
                <span className="lg:whitespace-nowrap">
                  Arrêtez de chercher.
                </span>
                <br />
                <span className="text-brand-coral lg:whitespace-nowrap">
                  Commencez à viser.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#c9c5f0]">
                Boussole parcourt les offres à votre place, note chacune selon
                votre profil et prépare un CV adapté au poste. Il ne vous reste
                qu'à choisir et postuler.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <DemoLink target={demoTarget} className={CTA_CORAL}>
                  Voir la démo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </DemoLink>
                <Link
                  to={enterLink.to}
                  className={demoTarget ? CTA_GHOST : CTA_CORAL}
                >
                  {enterLink.label}
                </Link>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-md">
              <BoussoleMark className="boussole-needle absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 text-brand-periwinkle/15" />
              <div className="relative space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a86bd]">
                  Exemple de matin avec Boussole
                </p>
                {EXAMPLE_MATCHES.map((match, index) => (
                  <div
                    key={match.title}
                    className={cn(
                      "boussole-float flex items-center gap-4 rounded-2xl border border-white/10 bg-[#17163a]/90 p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] backdrop-blur",
                      index === 1 && "ml-6 [animation-delay:-2s]",
                      index === 2 && "ml-12 [animation-delay:-4s]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-base font-extrabold tabular-nums",
                        scoreTone(match.score),
                      )}
                    >
                      {match.score}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {match.title}
                      </span>
                      <span className="block truncate text-sm text-[#a9a5d6]">
                        {match.meta}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section aria-labelledby="probleme" className="bg-brand-indigo py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-coral">
              Le problème
            </p>
            <h2
              id="probleme"
              className="mt-3 max-w-2xl font-display text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-brand-lilac"
            >
              Vous postulez partout. Personne ne répond.
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {PROBLEMS.map((problem) => (
                <article
                  key={problem.title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-6"
                >
                  <h3 className="font-display text-xl font-bold text-brand-lilac">
                    {problem.title}
                  </h3>
                  <p className="mt-2 text-[#c9c5f0]">{problem.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          aria-labelledby="fonctionnement"
          className="bg-brand-lilac py-20 text-brand-indigo"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c93a28]">
              Comment ça marche
            </p>
            <h2
              id="fonctionnement"
              className="mt-3 max-w-2xl font-display text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-brand-indigo"
            >
              Trois étapes, chaque jour, sans vous.
            </h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="rounded-2xl bg-white p-6 shadow-[0_12px_40px_-24px_rgba(29,27,84,0.5)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-indigo text-brand-lilac">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="font-display text-sm font-bold text-[#5d5a8c]">
                        Étape {index + 1}
                      </span>
                    </div>
                    <h3 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.02em] text-brand-indigo">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-[#3f3c74]">{step.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Privacy + stack */}
        <section className="py-20">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-[#17163a] p-7">
              <Lock className="h-6 w-6 text-brand-signal" aria-hidden="true" />
              <h2 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.02em] text-brand-lilac">
                Vos données restent chez vous
              </h2>
              <p className="mt-2 text-[#c9c5f0]">
                Boussole s'installe sur votre propre machine. Votre CV n'en sort
                que pour l'IA, sans email, téléphone ni adresse.
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-[#17163a] p-7">
              <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-brand-lilac">
                Sous le capot
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {STACK.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-white/15 px-3 py-1 text-sm text-[#c9c5f0]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-[#a9a5d6]">
                Projet open source conçu et développé par{" "}
                <a
                  href={BRAND.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-brand-lilac underline decoration-brand-coral underline-offset-4"
                >
                  {BRAND.author}
                </a>
                .
              </p>
            </article>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 rounded-3xl bg-brand-coral px-8 py-12 text-brand-indigo md:flex-row md:items-center md:justify-between">
            <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-brand-indigo">
              Prêt à viser juste ?
            </h2>
            <div className="flex flex-wrap gap-3">
              <DemoLink
                target={demoTarget}
                className={`${CTA_BASE} bg-brand-indigo text-brand-lilac hover:bg-[#2a2860] focus-visible:ring-offset-brand-coral`}
              >
                Voir la démo
              </DemoLink>
              <Link
                to={enterLink.to}
                className={`${CTA_BASE} bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/15 focus-visible:ring-offset-brand-coral`}
              >
                {enterLink.label}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-[#8a86bd] sm:px-6">
          <span>
            © 2026 {BRAND.author} · {BRAND.name}
          </span>
          <span className="flex gap-4">
            <a
              href={BRAND.authorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-lilac"
            >
              Portfolio
            </a>
            <a
              href={BRAND.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-lilac"
            >
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};

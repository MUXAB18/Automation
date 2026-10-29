import { BarChart3, Layers, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const POINTS = [
  {
    icon: Layers,
    title: "Every customer in one place",
    text: "Switch between businesses without switching tools.",
  },
  {
    icon: BarChart3,
    title: "Search and traffic, joined up",
    text: "Rankings and analytics side by side, per customer.",
  },
  {
    icon: ShieldCheck,
    title: "Approval before anything goes live",
    text: "Every change is reviewed and logged.",
  },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-from to-brand-to p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <BarChart3 className="size-5" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight">
            SEO &amp; Social Automation
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Grow every customer&rsquo;s search presence, from one dashboard.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-white/75">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          Internal tool &middot; authorised users only
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="fade-up w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="font-semibold tracking-tight">SEO &amp; Social Automation</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Sign in to manage your customers.</p>
          <div className="mt-8">
            <LoginForm />
          </div>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Access is by invitation. Need an account? Ask your administrator.
          </p>
        </div>
      </section>
    </main>
  );
}

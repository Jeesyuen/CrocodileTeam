import clsx from "clsx";
import { ArrowRight, Car, GraduationCap, ShieldCheck, Wrench } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CityIllustration, Logo } from "@/components/Illustrations";
import { Avatar, ErrorNote } from "@/components/ui";
import { homeFor, useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/meta";
import type { User } from "@/lib/types";

const FEATURED = [
  { email: "student.a@demo.saferoute.my", tag: "Student A", hint: "Reports hazards", icon: GraduationCap, bg: "bg-lavender" },
  { email: "student.b@demo.saferoute.my", tag: "Student B", hint: "Navigates & gets alerts", icon: GraduationCap, bg: "bg-mint" },
  { email: "driver@demo.saferoute.my", tag: "Driver", hint: "Traffic AI forecasts", icon: Car, bg: "bg-sky" },
  { email: "operator@demo.saferoute.my", tag: "Safety Operator", hint: "Verifies & resolves", icon: ShieldCheck, bg: "bg-peach" },
  { email: "maintenance@demo.saferoute.my", tag: "Maintenance", hint: "Clears hazards", icon: Wrench, bg: "bg-[#FDE4E6]" },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [accounts, setAccounts] = useState<User[]>([]);
  const [demoPw, setDemoPw] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api<{ password: string; accounts: User[] }>("/api/auth/demo-accounts")
      .then((r) => { setAccounts(r.accounts); setDemoPw(r.password); })
      .catch((e) => { if (e instanceof ApiError && e.status === 0) setError(e.message); });
  }, []);

  if (user) return <Navigate to={loc.state?.from && loc.state.from !== "/login" ? loc.state.from : homeFor(user.role)} replace />;

  const go = async (em: string, pw: string) => {
    setBusy(em); setError(null);
    try {
      const u = await login(em, pw);
      navigate(homeFor(u.role), { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed");
    } finally { setBusy(null); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); go(email, password); };
  const byEmail = Object.fromEntries(accounts.map((a) => [a.email, a]));

  return (
    <div className="min-h-full bg-canvas">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-12">
        <section className="relative overflow-hidden rounded-4xl bg-gradient-to-br from-lavender via-[#F1EEFF] to-mint p-7 shadow-soft sm:p-10">
          <div className="flex items-center gap-3">
            <Logo className="h-11 w-11" />
            <div>
              <div className="text-lg font-extrabold">SafeRoute AI</div>
              <div className="text-xs font-semibold text-lavender-deep">Cyberjaya 5G Future Talent Innovation Challenge 2026</div>
            </div>
          </div>
          <h1 className="mt-8 text-3xl font-extrabold leading-tight sm:text-[42px]">
            Predict traffic.<br />Detect hazards.<br /><span className="text-lavender-deep">Navigate smarter.</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] text-ink/70">
            Community hazard reports, AI photo analysis and congestion forecasting — combined into one routing engine for
            walking and driving around Cyberjaya.
          </p>
          <CityIllustration className="mx-auto mt-4 w-full max-w-[460px]" />
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="chip bg-white/70 text-ink">Track 2 · Connected & Safe Mobility</span>
            <span className="chip bg-white/70 text-[#9A6418]">Demo environment · synthetic hazards & traffic</span>
          </div>
        </section>

        <section className="card p-6 sm:p-8">
          <h2 className="text-2xl font-extrabold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted">Pick a demo account to explore each role. Permissions are enforced by the server.</p>
          {error && <div className="mt-4"><ErrorNote message={error} /></div>}

          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {FEATURED.map((f) => {
              const u = byEmail[f.email];
              return (
                <button key={f.email} disabled={!u || !!busy} onClick={() => u && demoPw && go(u.email, demoPw)}
                  className="group flex items-center gap-3 rounded-3xl bg-canvas p-3 text-left ring-1 ring-line transition hover:bg-white hover:shadow-soft disabled:opacity-60">
                  <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-ink", f.bg)}><f.icon size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{f.tag}</span>
                    <span className="block truncate text-xs text-muted">{u ? `${u.name} · ${f.hint}` : f.hint}</span>
                  </span>
                  <ArrowRight size={16} className={clsx("text-muted transition group-hover:translate-x-0.5", busy === f.email && "animate-pulse")} />
                </button>
              );
            })}
          </div>

          {accounts.length > 0 && (
            <button className="mt-3 text-xs font-semibold text-lavender-deep" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Hide" : "Show"} all {accounts.length} demo accounts
            </button>
          )}
          {showAll && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-3xl bg-canvas p-2 scroll-thin">
              {accounts.map((a) => (
                <button key={a.id} disabled={!!busy} onClick={() => demoPw && go(a.email, demoPw)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left hover:bg-white">
                  <Avatar name={a.name} color={a.avatar_color} size={30} />
                  <span className="flex-1 text-sm font-semibold">{a.name}</span>
                  <span className="text-xs text-muted">{ROLE_LABEL[a.role]}</span>
                </button>
              ))}
            </div>
          )}

          <div className="my-6 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or sign in with email<span className="h-px flex-1 bg-line" /></div>
          <form onSubmit={submit} className="space-y-3">
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button className="btn-primary w-full !py-3" disabled={!!busy}>Sign in</button>
            {demoPw && <p className="text-center text-xs text-muted">All demo accounts use the password <code className="rounded bg-canvas px-1.5 py-0.5 font-semibold">{demoPw}</code></p>}
          </form>
        </section>
      </div>
    </div>
  );
}

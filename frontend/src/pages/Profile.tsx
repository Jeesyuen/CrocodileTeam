import { Database, LogOut, MapPinned, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, PageHeader, Segmented } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useNav } from "@/context/NavigationContext";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/meta";
import type { Mode } from "@/lib/types";

const PREF_KEY = "saferoute.prefs";
interface Prefs { defaultMode: Mode; toasts: boolean }

function loadPrefs(): Prefs {
  try { return { defaultMode: "walk", toasts: true, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") }; } catch { return { defaultMode: "walk", toasts: true }; }
}

export default function Profile() {
  const { user, logout } = useAuth();
  const nav = useNav();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [health, setHealth] = useState<{ ai_configured: boolean; demo_mode: boolean } | null>(null);
  useEffect(() => { api<typeof health>("/api/health").then(setHealth).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);
  if (!user) return null;

  return (
    <div className="page max-w-3xl">
      <PageHeader title="Profile & settings" />
      <section className="card card-pad flex items-center gap-4">
        <Avatar name={user.name} color={user.avatar_color} size={64} />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold">{user.name}</div>
          <div className="text-sm text-muted">{user.email}</div>
          <span className="chip mt-1 bg-lavender text-lavender-deep">{ROLE_LABEL[user.role]}</span>
        </div>
        <button className="btn-outline" onClick={async () => { await nav.endNavigation(); logout(); navigate("/login"); }}><LogOut size={16} />Switch account</button>
      </section>

      <section className="card card-pad mt-5 space-y-5">
        <h2 className="font-bold">Preferences <span className="text-xs font-normal text-muted">· saved on this device</span></h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-semibold">Default travel mode</div><div className="text-sm text-muted">Used when you open Smart Navigation</div></div>
          <Segmented value={prefs.defaultMode} onChange={(m) => { setPrefs({ ...prefs, defaultMode: m }); nav.setMode(m); }}
            options={[{ value: "walk", label: "Walking" }, { value: "drive", label: "Driving" }]} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-semibold">Route alerts</div><div className="text-sm text-muted">Live alerts are always delivered for active navigation sessions.</div></div>
          <span className="chip bg-mint text-mint-deep">On</span>
        </div>
      </section>

      <section className="card card-pad mt-5">
        <h2 className="mb-3 font-bold">About the data</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3"><MapPinned size={18} className="shrink-0 text-lavender-deep" /><span><b>Roads & footpaths</b> are real OpenStreetMap data for the Cyberjaya pilot area (© OpenStreetMap contributors, ODbL). Walking and driving networks are kept separate.</span></li>
          <li className="flex gap-3"><Database size={18} className="shrink-0 text-[#B7791F]" /><span><b>Traffic</b> observations and forecasts are synthetic demonstration data — no live traffic feed is connected.</span></li>
          <li className="flex gap-3"><Database size={18} className="shrink-0 text-[#B7791F]" /><span><b>Seeded hazards</b> are synthetic. Reports you submit are real records in this demo database.</span></li>
          <li className="flex gap-3"><ShieldCheck size={18} className="shrink-0 text-mint-deep" /><span><b>AI photo analysis</b> is {health ? (health.ai_configured ? "enabled on this server" : "not configured on this server — classify hazards manually") : "…"}. AI output is a suggestion; only operators confirm closures.</span></li>
        </ul>
      </section>
    </div>
  );
}

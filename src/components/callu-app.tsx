import { useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  MicOff,
  Volume2,
  Video,
  Delete,
  Search,
  Clock,
  Users,
  Grid3x3,
  Globe,
} from "lucide-react";
import {
  CONTACTS,
  INITIAL_CALLS,
  AVATAR_STYLES,
  type Contact,
  type CallRecord,
} from "@/lib/callu-data";

type Tab = "calls" | "contacts" | "dialer";
type ActiveCall = { contact: Contact; number: string };

function formatTimer(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Avatar({ contact, size = "md" }: { contact: Contact; size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "size-7 text-xs",
    md: "size-10 text-base",
    lg: "size-28 text-5xl",
  } as const;
  return (
    <span
      className={`${sizes[size]} ${AVATAR_STYLES[contact.color]} grid shrink-0 place-items-center rounded-full font-display font-semibold`}
    >
      {contact.initials}
    </span>
  );
}

const DIAL_KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
] as const;

function DirectionIcon({ direction }: { direction: CallRecord["direction"] }) {
  if (direction === "missed") return <PhoneMissed className="size-3.5 text-coral" />;
  if (direction === "outgoing") return <PhoneOutgoing className="size-3.5 text-muted-foreground" />;
  return <PhoneIncoming className="size-3.5 text-mint" />;
}

function CallScreen({ call, onEnd }: { call: ActiveCall; onEnd: (seconds: number) => void }) {
  const [phase, setPhase] = useState<"calling" | "connected">("calling");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const connectTimeout = window.setTimeout(() => {
      setPhase("connected");
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    }, 2600);
    return () => {
      window.clearTimeout(connectTimeout);
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-mesh-dark text-white animate-rise">
      <div className="mx-auto flex h-full max-w-[430px] flex-col items-center px-6 pt-16 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
          {phase === "calling" ? "Calling…" : "Connected · Free"}
        </p>

        <div className="relative mt-10">
          {phase === "calling" && (
            <>
              <span className="animate-ring-pulse absolute inset-0 rounded-full bg-brand/40" />
              <span className="animate-ring-pulse absolute inset-0 rounded-full bg-brand/25 [animation-delay:0.8s]" />
            </>
          )}
          <div className="relative">
            <Avatar contact={call.contact} size="lg" />
          </div>
        </div>

        <h2 className="mt-8 font-display text-3xl font-semibold tracking-tight">
          {call.contact.name}
        </h2>
        <p className="mt-2 text-sm text-white/60">{call.number}</p>
        <p className="mt-4 font-display text-xl tabular-nums text-white/90">
          {phase === "connected" ? formatTimer(seconds) : "—:—"}
        </p>

        <div className="mt-auto flex w-full items-center justify-center gap-5">
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label="Mute"
            className={`grid size-16 place-items-center rounded-full ring-1 ring-white/25 transition-colors ${
              muted ? "bg-white text-ink" : "bg-white/10 text-white"
            }`}
          >
            {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </button>
          <button
            onClick={() => onEnd(seconds)}
            aria-label="End call"
            className="grid size-20 place-items-center rounded-full bg-coral text-white shadow-[0_12px_36px_-8px_rgba(244,63,94,0.7)] transition-transform active:scale-95"
          >
            <PhoneOff className="size-8" />
          </button>
          <button
            onClick={() => setSpeaker((s) => !s)}
            aria-label="Speaker"
            className={`grid size-16 place-items-center rounded-full ring-1 ring-white/25 transition-colors ${
              speaker ? "bg-mint text-white" : "bg-white/10 text-white"
            }`}
          >
            <Volume2 className="size-6" />
          </button>
        </div>
        <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-white/40">
          via Call u · no minutes used
        </p>
      </div>
    </div>
  );
}

export default function CallUApp() {
  const [tab, setTab] = useState<Tab>("calls");
  const [calls, setCalls] = useState<CallRecord[]>(INITIAL_CALLS);
  const [dialed, setDialed] = useState("");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [query, setQuery] = useState("");

  const startCall = (contact: Contact, number?: string) => {
    setActiveCall({ contact, number: number ?? contact.phone });
  };

  const dialNumber = () => {
    if (!dialed.trim()) return;
    const known = CONTACTS.find((c) => c.phone.replace(/\D/g, "").endsWith(dialed.replace(/\D/g, "")));
    const contact: Contact =
      known ?? {
        id: "unknown",
        name: dialed,
        label: "Unknown number",
        phone: dialed,
        initials: "#",
        color: "sky",
      };
    startCall(contact, dialed);
  };

  const endCall = (seconds: number) => {
    if (activeCall) {
      setCalls((prev) => [
        {
          id: `c${Date.now()}`,
          contact: activeCall.contact,
          direction: "outgoing",
          when: "Just now",
          duration: formatTimer(seconds),
        },
        ...prev,
      ]);
    }
    setActiveCall(null);
    setDialed("");
  };

  const filteredContacts = CONTACTS.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="bg-mesh min-h-dvh font-body text-ink">
      <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-6">
        <header className="flex items-center justify-between pt-6">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-brand font-display text-lg font-bold text-white shadow-sm">
              C
            </span>
            <span className="font-display text-[17px] font-semibold tracking-tight">Call u</span>
          </div>
          <span className="flex h-10 items-center gap-1.5 rounded-full border border-ink/10 bg-white/70 px-3 text-xs font-medium text-muted-foreground">
            <Globe className="size-3.5 text-mint" /> Free worldwide
          </span>
        </header>

        {tab === "calls" && (
          <div className="animate-rise">
            <section className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                Free calls
              </p>
              <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.05] tracking-tight">
                Talk to anyone. <span className="text-coral">Zero charge.</span>
              </h1>
              <p className="mt-2 max-w-[280px] text-[15px] leading-relaxed text-muted-foreground">
                Crystal-clear calls to 60+ countries, no paywall, no minutes to track.
              </p>
            </section>

            <section className="mt-7">
              <h2 className="font-display text-[15px] font-semibold">Quick dial</h2>
              <div className="mt-3 flex gap-3">
                {CONTACTS.slice(0, 3).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => startCall(c)}
                    className="flex items-center gap-2 rounded-xl border border-ink/5 bg-white/80 px-3 py-2.5 shadow-sm transition-transform active:scale-95"
                  >
                    <Avatar contact={c} size="sm" />
                    <div className="leading-tight text-left">
                      <p className="text-[13px] font-semibold">{c.name.split(" ")[0]}</p>
                      <p className="text-[11px] text-muted-foreground">{c.label}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-7">
              <h2 className="font-display text-[15px] font-semibold">Recent calls</h2>
              <div className="mt-3 space-y-2">
                {calls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center gap-3 rounded-xl border border-ink/5 bg-white/85 p-3 shadow-sm"
                  >
                    <Avatar contact={call.contact} />
                    <div className="flex-1 leading-tight">
                      <p className="text-[14px] font-semibold">{call.contact.name}</p>
                      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <DirectionIcon direction={call.direction} />
                        {call.when}
                        {call.duration ? ` · ${call.duration}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => startCall(call.contact)}
                      aria-label={`Call ${call.contact.name}`}
                      className={`grid size-10 place-items-center rounded-full transition-transform active:scale-95 ${
                        call.direction === "missed"
                          ? "bg-coral/10 text-coral"
                          : "bg-mint/10 text-mint"
                      }`}
                    >
                      <Phone className="size-4.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-7 rounded-2xl bg-brand p-5 text-white shadow-sm">
              <p className="font-display text-[17px] font-semibold">60+ countries</p>
              <p className="mt-1 text-[13px] text-white/80">
                Unlimited free calls worldwide, on any device.
              </p>
            </section>

            <button
              onClick={() => setTab("dialer")}
              className="mt-6 h-14 w-full rounded-2xl bg-coral font-display text-[16px] font-semibold text-white shadow-sm transition-opacity active:opacity-90"
            >
              Start a free call
            </button>
          </div>
        )}

        {tab === "contacts" && (
          <div className="animate-rise mt-8">
            <h1 className="font-display text-[28px] font-semibold tracking-tight">Contacts</h1>
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 shadow-sm">
              <Search className="size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a friend…"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="mt-4 space-y-2">
              {filteredContacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-ink/5 bg-white/85 p-3 shadow-sm"
                >
                  <Avatar contact={c} />
                  <div className="flex-1 leading-tight">
                    <p className="text-[14px] font-semibold">{c.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {c.label} · {c.phone}
                    </p>
                  </div>
                  <button
                    onClick={() => startCall(c)}
                    aria-label={`Voice call ${c.name}`}
                    className="grid size-10 place-items-center rounded-full bg-mint/10 text-mint transition-transform active:scale-95"
                  >
                    <Phone className="size-4.5" />
                  </button>
                  <button
                    onClick={() => startCall(c)}
                    aria-label={`Video call ${c.name}`}
                    className="grid size-10 place-items-center rounded-full bg-brand/10 text-brand transition-transform active:scale-95"
                  >
                    <Video className="size-4.5" />
                  </button>
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No contacts match “{query}”.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === "dialer" && (
          <div className="animate-rise mt-8 flex flex-1 flex-col">
            <h1 className="font-display text-[28px] font-semibold tracking-tight">Dialer</h1>
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-ink/5 bg-white/85 px-5 py-4 shadow-sm">
              <span className="min-h-8 font-display text-2xl font-semibold tracking-[0.12em]">
                {dialed || <span className="text-muted-foreground/60">Enter number</span>}
              </span>
              <button
                onClick={() => setDialed((d) => d.slice(0, -1))}
                aria-label="Backspace"
                className="text-muted-foreground transition-colors hover:text-ink"
              >
                <Delete className="size-6" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {DIAL_KEYS.map(([key, sub]) => (
                <button
                  key={key}
                  onClick={() => setDialed((d) => d + key)}
                  className="flex h-14 flex-col items-center justify-center rounded-2xl border border-ink/5 bg-white/70 shadow-sm transition-transform active:scale-95"
                >
                  <span className="font-display text-xl font-semibold leading-none">{key}</span>
                  {sub && (
                    <span className="mt-0.5 text-[9px] font-medium tracking-[0.2em] text-muted-foreground">
                      {sub}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={dialNumber}
              disabled={!dialed.trim()}
              className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-mint font-display text-base font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Phone className="size-5" /> Call for free
            </button>
          </div>
        )}

        <nav className="mt-auto pt-8">
          <div className="grid grid-cols-3 gap-2 rounded-full border border-ink/5 bg-white/70 p-1.5 shadow-sm backdrop-blur">
            {(
              [
                ["calls", "Calls", Clock],
                ["contacts", "Contacts", Users],
                ["dialer", "Dialer", Grid3x3],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-xs font-semibold transition-colors ${
                  tab === id ? "bg-ink text-white" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {activeCall && <CallScreen call={activeCall} onEnd={endCall} />}
    </div>
  );
}

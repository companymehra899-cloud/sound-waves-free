import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Loader2,
  Globe,
  Volume2,
  X,
  PhoneIncoming,
} from "lucide-react";

type Phase = "idle" | "searching" | "connecting" | "live" | "ended";

type Signal = {
  kind: "ready" | "offer" | "answer" | "ice" | "bye";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type QueueResult = {
  id?: string;
  matched?: boolean;
  expired?: boolean;
  room_id?: string;
  call_role?: "caller" | "callee";
  partner_nickname?: string;
  partner_country?: string;
  partner_age?: number | null;
  partner_topic?: string;
};

type MatchInfo = {
  roomId: string;
  role: "caller" | "callee";
  partner: string;
  partnerCountry?: string;
  partnerAge?: number | null;
  partnerTopic?: string;
};

type Profile = {
  nickname: string;
  country: string;
  age: string;
  topic: string;
};

type PastCall = {
  partner: string;
  seconds: number;
  at: number;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    // Free public TURN relay (OpenRelay) — fallback for strict Wi-Fi/mobile networks
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

const AVATAR_COLORS = [
  "bg-brand/15 text-brand",
  "bg-coral/15 text-coral",
  "bg-mint/15 text-mint",
] as const;

function avatarColor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatTimer(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatWhen(at: number) {
  const diff = Date.now() - at;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(at).toLocaleDateString();
}

export default function SpeakPractice() {
  const [profile, setProfile] = useState<Profile>({
    nickname: "",
    country: "",
    age: "",
    topic: "",
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pastCalls, setPastCalls] = useState<PastCall[]>([]);

  const queueIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteReadyRef = useRef(false);
  const endCallRef = useRef<((message?: string) => Promise<void>) | null>(null);
  const matchRef = useRef<MatchInfo | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("callu_profile") ?? "null",
      ) as Profile | null;
      if (saved) setProfile(saved);
      else {
        const oldNick = window.localStorage.getItem("callu_nickname");
        if (oldNick) setProfile((p) => ({ ...p, nickname: oldNick }));
      }
    } catch {
      /* ignore */
    }
    try {
      const history = JSON.parse(
        window.localStorage.getItem("callu_history") ?? "[]",
      ) as PastCall[];
      setPastCalls(history.slice(0, 10));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  useEffect(() => {
    if (phase !== "connecting") return;
    const timeout = setTimeout(() => {
      void endCallRef.current?.(
        "Couldn't connect to your partner — this can happen on strict Wi-Fi or mobile networks. Please try again.",
      );
    }, 30000);
    return () => clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const cleanup = useCallback(async (removeFromQueue: boolean) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    if (removeFromQueue && queueIdRef.current) {
      await supabase.rpc("leave_call_queue", { p_id: queueIdRef.current });
    }
    queueIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void cleanup(true);
    };
  }, [cleanup]);

  const endCall = useCallback(
    async (message?: string) => {
      const wasLive = phase === "live" || phase === "connecting";
      channelRef.current?.send({ type: "broadcast", event: "signal", payload: { kind: "bye" } });

      if (phase === "live" && matchRef.current) {
        const entry: PastCall = {
          partner: matchRef.current.partner,
          seconds: secondsRef.current,
          at: Date.now(),
        };
        setPastCalls((prev) => {
          const next = [entry, ...prev].slice(0, 10);
          window.localStorage.setItem("callu_history", JSON.stringify(next));
          return next;
        });
      }

      await cleanup(true);
      setMuted(false);
      setSpeaker(false);
      setNotice(message ?? null);
      setPhase(wasLive ? "ended" : "idle");
      if (!wasLive) setMatch(null);
    },
    [cleanup, phase],
  );

  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  const startWebRTC = useCallback(
    async (info: MatchInfo) => {
      setMatch(info);
      setPhase("connecting");
      setSeconds(0);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
        if (audioRef.current) {
          audioRef.current.srcObject = remoteStream;
          void audioRef.current.play().catch(() => undefined);
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") setPhase("live");
        if (state === "failed") void endCall("Connection dropped. Try again.");
      };

      const channel = supabase.channel(`practice-room-${info.roomId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      const send = (payload: Record<string, unknown>) =>
        channel.send({ type: "broadcast", event: "signal", payload });

      pc.onicecandidate = (event) => {
        if (event.candidate) void send({ kind: "ice", candidate: event.candidate.toJSON() });
      };

      const makeOffer = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        void send({ kind: "offer", sdp: offer });
      };

      const drainIce = async () => {
        for (const c of pendingIceRef.current) {
          await pc.addIceCandidate(c).catch(() => undefined);
        }
        pendingIceRef.current = [];
      };

      channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const data = payload as Signal;
        try {
          if (data.kind === "ready") {
            if (info.role === "caller") {
              if (!remoteReadyRef.current) {
                remoteReadyRef.current = true;
                await makeOffer();
              }
            } else if (!remoteReadyRef.current) {
              // Let the caller know we are here, in case our first ping was early.
              remoteReadyRef.current = true;
              void send({ kind: "ready" });
            }
          } else if (data.kind === "offer" && info.role === "callee") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp!));
            await drainIce();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            void send({ kind: "answer", sdp: answer });
          } else if (data.kind === "answer" && info.role === "caller") {
            if (!pc.currentRemoteDescription) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp!));
              await drainIce();
            }
          } else if (data.kind === "ice") {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(data.candidate!).catch(() => undefined);
            } else {
              pendingIceRef.current.push(data.candidate!);
            }
          } else if (data.kind === "bye") {
            void endCall(`${info.partner} left the call.`);
          }
        } catch {
          void endCall("Something went wrong connecting. Try again.");
        }
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") void send({ kind: "ready" });
      });
    },
    [endCall],
  );

  const findPartner = useCallback(async () => {
    setError(null);
    setNotice(null);
    setMatch(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
    } catch {
      setError("Microphone access is needed to talk. Please allow it and try again.");
      return;
    }

    setPhase("searching");
    const nick = profile.nickname.trim() || "Guest";
    const country = profile.country.trim();
    const topic = profile.topic.trim();
    const ageNum = parseInt(profile.age, 10);
    const age = Number.isFinite(ageNum) && ageNum > 0 ? ageNum : null;
    window.localStorage.setItem(
      "callu_profile",
      JSON.stringify({ ...profile, nickname: nick }),
    );

    const { data, error: rpcError } = await supabase.rpc("join_call_queue", {
      p_nickname: nick,
      p_country: country,
      ...(age !== null ? { p_age: age } : {}),
      p_topic: topic,
    });

    if (rpcError || !data) {
      await cleanup(false);
      setPhase("idle");
      setError("Could not reach the matching service. Please try again.");
      return;
    }

    const result = data as QueueResult;
    queueIdRef.current = result.id ?? null;

    if (result.matched) {
      await startWebRTC({
        roomId: result.room_id!,
        role: result.call_role ?? "callee",
        partner: result.partner_nickname ?? "Partner",
        partnerCountry: result.partner_country ?? "",
        partnerAge: result.partner_age ?? null,
        partnerTopic: result.partner_topic ?? "",
      });
      return;
    }

    pollRef.current = setInterval(async () => {
      if (!queueIdRef.current) return;
      const { data: poll } = await supabase.rpc("check_call_match", {
        p_id: queueIdRef.current,
      });
      const res = poll as QueueResult | null;
      if (!res) return;
      if (res.expired) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        await cleanup(false);
        setPhase("idle");
        setNotice("Your spot in the queue expired. Tap to search again.");
        return;
      }
      if (res.matched) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        await startWebRTC({
          roomId: res.room_id!,
          role: res.call_role ?? "callee",
          partner: res.partner_nickname ?? "Partner",
          partnerCountry: res.partner_country ?? "",
          partnerAge: res.partner_age ?? null,
          partnerTopic: res.partner_topic ?? "",
        });
      }
    }, 1500);
  }, [cleanup, profile, startWebRTC]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => (t.enabled = !next));
    setMuted(next);
  };

  const inCall = phase === "connecting" || phase === "live";

  return (
    <main className="bg-mesh min-h-dvh font-body text-ink">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

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

        {!inCall && phase !== "ended" && (
          <div className="animate-rise">
            <section className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                Free voice calls
              </p>
              <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.05] tracking-tight">
                Practice English. <span className="text-coral">With real people.</span>
              </h1>
              <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
                Get paired with another learner who is online right now. Voice only — no sign
                up, no phone number.
              </p>
            </section>

            <section className="mt-7">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your profile
              </label>
              <div className="mt-2 space-y-2">
                <input
                  value={profile.nickname}
                  onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
                  placeholder="Name (e.g. Rahul)"
                  maxLength={24}
                  className="w-full rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 text-[15px] shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <div className="flex gap-2">
                  <input
                    value={profile.country}
                    onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))}
                    placeholder="Country"
                    maxLength={32}
                    className="w-full min-w-0 flex-1 rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 text-[15px] shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <input
                    value={profile.age}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        age: e.target.value.replace(/\D/g, "").slice(0, 3),
                      }))
                    }
                    placeholder="Age"
                    inputMode="numeric"
                    className="w-24 rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 text-[15px] shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <input
                  value={profile.topic}
                  onChange={(e) => setProfile((p) => ({ ...p, topic: e.target.value }))}
                  placeholder="Topic you want to talk about (e.g. Travel)"
                  maxLength={60}
                  className="w-full rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 text-[15px] shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </section>

            {phase === "searching" ? (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-center gap-3 rounded-2xl border border-ink/5 bg-white/85 px-4 py-4 shadow-sm">
                  <Loader2 className="size-5 animate-spin text-brand" />
                  <span className="text-sm font-medium">Looking for a partner…</span>
                </div>
                <button
                  onClick={() => void endCall()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-ink/10 py-3 text-sm font-semibold text-muted-foreground"
                >
                  <X className="size-4" /> Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => void findPartner()}
                className="mt-6 h-14 w-full rounded-2xl bg-coral font-display text-[16px] font-semibold text-white shadow-sm transition-opacity active:opacity-90"
              >
                Start a free call
              </button>
            )}

            {error && (
              <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm text-coral">
                {error}
              </p>
            )}
            {notice && !error && (
              <p className="mt-4 rounded-2xl border border-ink/5 bg-white/85 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                {notice}
              </p>
            )}

            {pastCalls.length > 0 && (
              <section className="mt-7">
                <h2 className="font-display text-[15px] font-semibold">Recent calls</h2>
                <div className="mt-3 space-y-2">
                  {pastCalls.map((call) => (
                    <div
                      key={call.at}
                      className="flex items-center gap-3 rounded-xl border border-ink/5 bg-white/85 p-3 shadow-sm"
                    >
                      <span
                        className={`${avatarColor(call.partner)} grid size-10 shrink-0 place-items-center rounded-full font-display text-base font-semibold`}
                      >
                        {call.partner.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 leading-tight">
                        <p className="text-[14px] font-semibold">{call.partner}</p>
                        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <PhoneIncoming className="size-3.5 text-mint" />
                          {formatWhen(call.at)} · {formatTimer(call.seconds)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-7 rounded-2xl bg-brand p-5 text-white shadow-sm">
              <p className="font-display text-[17px] font-semibold">Talk to the world</p>
              <p className="mt-1 text-[13px] text-white/80">
                Every call pairs you with a real person, directly phone-to-phone. Keep it kind
                — introduce yourself and pick a topic.
              </p>
            </section>
          </div>
        )}

        {inCall && match && (
          <div className="fixed inset-0 z-50 bg-mesh-dark text-white animate-rise">
            <div className="mx-auto flex h-full max-w-[430px] flex-col items-center px-6 pt-16 pb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                {phase === "connecting" ? "Calling…" : "Connected · Free"}
              </p>

              <div className="relative mt-10">
                {phase === "connecting" && (
                  <>
                    <span className="animate-ring-pulse absolute inset-0 rounded-full bg-brand/40" />
                    <span className="animate-ring-pulse absolute inset-0 rounded-full bg-brand/25 [animation-delay:0.8s]" />
                  </>
                )}
                <div className="relative grid size-28 place-items-center rounded-full bg-brand font-display text-5xl font-bold text-white shadow-2xl">
                  {match.partner.charAt(0).toUpperCase()}
                </div>
              </div>

              <h2 className="mt-8 font-display text-3xl font-semibold tracking-tight">
                {match.partner}
              </h2>
              <p className="mt-2 text-sm text-white/60">
                {[
                  match.partnerCountry || null,
                  match.partnerAge ? `${match.partnerAge} yrs` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "English practice partner"}
              </p>
              {match.partnerTopic && (
                <p className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-[13px] font-medium text-white/85 ring-1 ring-white/20">
                  Topic: {match.partnerTopic}
                </p>
              )}
              <p className="mt-4 font-display text-xl tabular-nums text-white/90">
                {phase === "live" ? formatTimer(seconds) : "—:—"}
              </p>

              <div className="mt-auto flex w-full items-center justify-center gap-5">
                <button
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className={`grid size-16 place-items-center rounded-full ring-1 ring-white/25 transition-colors ${
                    muted ? "bg-white text-ink" : "bg-white/10 text-white"
                  }`}
                >
                  {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
                </button>
                <button
                  onClick={() => void endCall("Call ended.")}
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
        )}

        {phase === "ended" && (
          <section className="mt-10 animate-rise rounded-2xl border border-ink/5 bg-white/85 p-6 text-center shadow-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-mint/15 text-mint">
              <Phone className="size-5" />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold">Call finished</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {notice ?? "Nice work."} You talked for {formatTimer(seconds)}.
            </p>
            <button
              onClick={() => {
                setPhase("idle");
                setMatch(null);
                setNotice(null);
              }}
              className="mt-6 h-14 w-full rounded-2xl bg-coral font-display text-[16px] font-semibold text-white shadow-sm transition-opacity active:opacity-90"
            >
              Practice again
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

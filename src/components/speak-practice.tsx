import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mic, MicOff, PhoneOff, Loader2, Globe2, Volume2, X } from "lucide-react";

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
};

type MatchInfo = {
  roomId: string;
  role: "caller" | "callee";
  partner: string;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function SpeakPractice() {
  const [nickname, setNickname] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const queueIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteReadyRef = useRef(false);
  const endCallRef = useRef<((message?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("callu_nickname");
    if (saved) setNickname(saved);
  }, []);

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
      await cleanup(true);
      setMuted(false);
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
    const nick = nickname.trim() || "Guest";
    window.localStorage.setItem("callu_nickname", nick);

    const { data, error: rpcError } = await supabase.rpc("join_call_queue", {
      p_nickname: nick,
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
        });
      }
    }, 1500);
  }, [cleanup, nickname, startWebRTC]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => (t.enabled = !next));
    setMuted(next);
  };

  const inCall = phase === "connecting" || phase === "live";

  return (
    <main className="bg-mesh min-h-dvh px-5 py-8 font-body">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Globe2 className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">Call u</h1>
            <p className="text-xs text-muted-foreground">English speaking practice, live</p>
          </div>
        </header>

        {!inCall && (
          <section className="mt-8 animate-rise rounded-4xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur">
            <h2 className="font-display text-2xl font-bold leading-tight">
              Talk to a real person right now
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Tap below and you'll be paired with another learner who is waiting. Voice only —
              no sign up, no phone number.
            </p>

            <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your name
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Rahul"
              maxLength={24}
              className="mt-2 w-full rounded-2xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            />

            {phase === "searching" ? (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-center gap-3 rounded-2xl bg-secondary px-4 py-4 text-secondary-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-sm font-medium">Looking for a partner…</span>
                </div>
                <button
                  onClick={() => void endCall()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3 text-sm font-semibold text-muted-foreground"
                >
                  <X className="size-4" /> Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => void findPartner()}
                className="mt-6 w-full rounded-2xl bg-primary py-4 font-display text-base font-bold text-primary-foreground shadow-lg transition active:scale-[0.98]"
              >
                Find a partner
              </button>
            )}

            {error && (
              <p className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && !error && (
              <p className="mt-4 rounded-2xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
                {notice}
              </p>
            )}

            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li>• Calls connect directly between the two phones.</li>
              <li>• Keep it kind — introduce yourself and pick a topic.</li>
              <li>• Leave any time; the next partner is one tap away.</li>
            </ul>
          </section>
        )}

        {inCall && match && (
          <section className="mt-10 animate-rise flex flex-col items-center text-center">
            <div className="relative grid size-32 place-items-center">
              <span className="absolute inset-0 rounded-full bg-primary/25 animate-ring-pulse" />
              <div className="grid size-28 place-items-center rounded-full bg-primary font-display text-4xl font-bold text-primary-foreground shadow-2xl">
                {match.partner.charAt(0).toUpperCase()}
              </div>
            </div>

            <h2 className="mt-6 font-display text-2xl font-bold">{match.partner}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {phase === "connecting" ? "Connecting…" : formatDuration(seconds)}
            </p>

            <div className="mt-3 flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-xs font-medium text-muted-foreground shadow">
              <Volume2 className="size-4" />
              {phase === "live" ? "Live voice call" : "Setting up audio"}
            </div>

            <div className="mt-12 flex items-center gap-6">
              <button
                onClick={toggleMute}
                className={`grid size-16 place-items-center rounded-full shadow-lg transition active:scale-95 ${
                  muted
                    ? "bg-foreground text-background"
                    : "bg-card text-foreground"
                }`}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
              </button>
              <button
                onClick={() => void endCall("Call ended.")}
                className="grid size-20 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-xl transition active:scale-95"
                aria-label="End call"
              >
                <PhoneOff className="size-7" />
              </button>
            </div>
          </section>
        )}

        {phase === "ended" && (
          <section className="mt-10 animate-rise rounded-4xl border border-border bg-card/80 p-6 text-center shadow-xl">
            <h2 className="font-display text-xl font-bold">Call finished</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {notice ?? "Nice work."} You talked for {formatDuration(seconds)}.
            </p>
            <button
              onClick={() => {
                setPhase("idle");
                setMatch(null);
                setNotice(null);
              }}
              className="mt-6 w-full rounded-2xl bg-primary py-4 font-display font-bold text-primary-foreground shadow-lg active:scale-[0.98]"
            >
              Practice again
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

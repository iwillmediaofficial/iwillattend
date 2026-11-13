import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CircleAlert, CircleCheck, MapPin, RefreshCw } from "lucide-react";
import { Button, ErrorText, Modal } from "./ui";
import { errMsg, getPosition } from "../lib/utils";
import { describeFace, faceGuide, loadFace } from "../lib/face";
import { supabase } from "../lib/supabase";

export interface Capture {
  blob: Blob;
  lat: number;
  lng: number;
  accuracy: number;
  /** Face template of the selfie, when face check is on and the model loaded. */
  descriptor?: number[];
  /** What the staff member was shown before confirming. */
  verdict?: Verdict;
}

/** matched / mismatch come from the server; unchecked means the check could not run. */
export type Verdict = "matched" | "mismatch" | "unchecked";

/**
 * Live-camera selfie + GPS capture. The photo can only come from the camera
 * stream (no gallery upload), and location is read fresh each time.
 */
export function CaptureFlow({
  title,
  confirmLabel,
  onClose,
  onConfirm,
  face = false,
  children,
}: {
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (c: Capture) => Promise<void>;
  /** Require a detectable face in the selfie and return its template. */
  face?: boolean;
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState("");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [posError, setPosError] = useState("");
  const [locating, setLocating] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string; descriptor?: number[] } | null>(null);
  // "failed" means the model could not load: the punch still goes through, just unverified.
  const [faceState, setFaceState] = useState<"off" | "loading" | "ready" | "failed">(face ? "loading" : "off");
  const [checking, setChecking] = useState(false);
  // Live hint while the camera is open: is a face in view and close enough?
  const [guide, setGuide] = useState<"none" | "far" | "ok" | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictNote, setVerdictNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const locate = () => {
    setLocating(true);
    setPosError("");
    getPosition()
      .then(setPos)
      .catch((e) => setPosError(errMsg(e)))
      .finally(() => setLocating(false));
  };

  useEffect(() => {
    let cancelled = false;
    locate();
    if (face) {
      loadFace()
        .then(() => !cancelled && setFaceState("ready"))
        .catch(() => !cancelled && setFaceState("failed"));
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("Camera is not available. Open this site over HTTPS (or localhost) in a modern browser.");
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            void videoRef.current.play().catch(() => undefined);
          }
        })
        .catch(() => setCamError("Camera permission was denied or no camera was found. Allow camera access and try again."));
    }
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  // Look for a face about twice a second while the live camera is showing.
  useEffect(() => {
    if (faceState !== "ready" || !camReady || shot) return;
    let stop = false;
    let running = false;
    const timer = window.setInterval(async () => {
      const v = videoRef.current;
      if (running || stop || !v || !v.videoWidth) return;
      running = true;
      const g = await faceGuide(v).catch(() => null);
      running = false;
      if (!stop) setGuide(g);
    }, 600);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [faceState, camReady, shot]);

  const snap = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const out = Math.min(480, size);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, out, out);
    setError("");
    let descriptor: number[] | undefined;
    setVerdict(null);
    setVerdictNote("");
    if (faceState === "ready") {
      setChecking(true);
      const d = await describeFace(canvas).catch(() => null);
      if (!d) {
        setChecking(false);
        setError("No face detected. Face the camera in good light and try again.");
        return;
      }
      descriptor = d;
      // Ask the server to compare, so the result is shown before confirming.
      const { data, error: checkError } = await supabase.rpc("check_face", { p_descriptor: d });
      setChecking(false);
      if (checkError) {
        setVerdict("unchecked");
        setVerdictNote(checkError.message);
      } else {
        setVerdict((data as { matched: boolean }).matched ? "matched" : "mismatch");
      }
    }
    canvas.toBlob((blob) => blob && setShot({ blob, url: URL.createObjectURL(blob), descriptor }), "image/jpeg", 0.7);
  };

  const confirm = async () => {
    if (!shot || !pos) return;
    setSaving(true);
    setError("");
    try {
      await onConfirm({ blob: shot.blob, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, descriptor: shot.descriptor, verdict: verdict ?? undefined });
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={saving ? () => undefined : onClose}>
      <div className="space-y-4">
        <div className={`relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900 ring-4 ${shot ? (verdict === "matched" ? "ring-success-500" : verdict === "mismatch" ? "ring-rose-500" : "ring-transparent") : guide === "ok" ? "ring-success-500" : guide ? "ring-amber-400" : "ring-transparent"}`}>
          <video
            ref={videoRef}
            playsInline
            muted
            onLoadedData={() => setCamReady(true)}
            className={`h-full w-full -scale-x-100 object-cover ${shot ? "hidden" : ""}`}
          />
          {shot && <img src={shot.url} alt="Your selfie" className="h-full w-full -scale-x-100 object-cover" />}
          {!camReady && !camError && <p className="absolute inset-0 grid place-items-center text-sm text-slate-300">Starting camera…</p>}
          {!shot && guide && (
            <p aria-live="polite" className={`absolute inset-x-0 bottom-0 py-1.5 text-center text-sm font-medium text-white ${guide === "ok" ? "bg-success-600/85" : "bg-amber-600/85"}`}>
              {guide === "ok" ? "Face detected. Hold still and take the selfie." : guide === "far" ? "Move closer to the camera." : "No face found. Look at the camera."}
            </p>
          )}
        </div>
        <ErrorText>{camError}</ErrorText>

        {shot && verdict === "matched" && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-sm font-medium text-success-700">
            <CircleCheck className="h-5 w-5 shrink-0" /> Face matched
          </p>
        )}
        {shot && verdict === "mismatch" && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <span><b>Face does not match your registered face.</b> Retake in better light, facing the camera. If you continue, this will be flagged to your manager.</span>
          </p>
        )}
        {shot && verdict === "unchecked" && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <span>Your face could not be checked here. {verdictNote}</span>
          </p>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-slate-700">
            <MapPin className="h-4 w-4 shrink-0 text-brand-600" />
            {pos
              ? `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy)} m)`
              : locating
                ? "Getting your location…"
                : "Location not available"}
          </span>
          <button type="button" onClick={locate} disabled={locating} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="Refresh location">
            <RefreshCw className={`h-4 w-4 ${locating ? "animate-spin" : ""}`} />
          </button>
        </div>
        <ErrorText>{posError}</ErrorText>

        {children}
        <ErrorText>{error}</ErrorText>

        <div className="flex gap-3">
          {shot ? (
            <>
              <Button variant="outline" className="flex-1" onClick={() => { setShot(null); setVerdict(null); setGuide(null); }} disabled={saving}>
                Retake
              </Button>
              <Button variant={verdict === "mismatch" ? "danger" : "success"} className="flex-1" onClick={confirm} loading={saving} disabled={!pos}>
                {verdict === "mismatch" ? "Continue anyway" : confirmLabel}
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={snap} loading={checking} disabled={!camReady || faceState === "loading"}>
              <Camera className="h-4 w-4" /> {faceState === "loading" ? "Preparing face check…" : "Take selfie"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, MapPin, RefreshCw } from "lucide-react";
import { Button, ErrorText, Modal } from "./ui";
import { errMsg, getPosition } from "../lib/utils";

export interface Capture {
  blob: Blob;
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Live-camera selfie + GPS capture. The photo can only come from the camera
 * stream (no gallery upload), and location is read fresh each time.
 */
export function CaptureFlow({
  title,
  confirmLabel,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (c: Capture) => Promise<void>;
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState("");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [posError, setPosError] = useState("");
  const [locating, setLocating] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
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

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const out = Math.min(480, size);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, out, out);
    canvas.toBlob((blob) => blob && setShot({ blob, url: URL.createObjectURL(blob) }), "image/jpeg", 0.7);
  };

  const confirm = async () => {
    if (!shot || !pos) return;
    setSaving(true);
    setError("");
    try {
      await onConfirm({ blob: shot.blob, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={saving ? () => undefined : onClose}>
      <div className="space-y-4">
        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          <video
            ref={videoRef}
            playsInline
            muted
            onLoadedData={() => setCamReady(true)}
            className={`h-full w-full -scale-x-100 object-cover ${shot ? "hidden" : ""}`}
          />
          {shot && <img src={shot.url} alt="Your selfie" className="h-full w-full -scale-x-100 object-cover" />}
          {!camReady && !camError && <p className="absolute inset-0 grid place-items-center text-sm text-slate-300">Starting camera…</p>}
        </div>
        <ErrorText>{camError}</ErrorText>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-slate-700">
            <MapPin className="h-4 w-4 shrink-0 text-indigo-600" />
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
              <Button variant="outline" className="flex-1" onClick={() => setShot(null)} disabled={saving}>
                Retake
              </Button>
              <Button variant="success" className="flex-1" onClick={confirm} loading={saving} disabled={!pos}>
                {confirmLabel}
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={snap} disabled={!camReady}>
              <Camera className="h-4 w-4" /> Take selfie
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { ScanFace } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button, ErrorText, Modal } from "./ui";
import { averageDescriptors, describeFace, loadFace } from "../lib/face";
import { errMsg } from "../lib/utils";

const SHOTS = 3;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One-time face registration: consent, then three live captures averaged into one template. */
export function FaceEnroll({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camReady, setCamReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    loadFace()
      .then(() => !cancelled && setModelReady(true))
      .catch(() => !cancelled && setError("Could not load face recognition. Check your internet connection and reopen this screen."));
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not available. Open this site over HTTPS (or localhost) in a modern browser.");
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            void videoRef.current.play().catch(() => undefined);
          }
        })
        .catch(() => setError("Camera permission was denied or no camera was found."));
    }
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const register = async () => {
    const v = videoRef.current;
    if (!v) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const found: number[][] = [];
      for (let attempt = 0; attempt < SHOTS * 3 && found.length < SHOTS; attempt++) {
        const d = await describeFace(v);
        if (d) {
          found.push(d);
          setProgress(found.length);
        }
        await wait(500);
      }
      if (found.length < SHOTS) throw new Error("Could not see your face clearly. Face the camera in good light, without a mask, and try again.");
      const { error } = await supabase.rpc("enroll_face", { p_descriptor: averageDescriptors(found), p_consent: true });
      if (error) throw error;
      await onDone();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Register your face" onClose={busy ? () => undefined : onClose}>
      <div className="space-y-4">
        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          <video ref={videoRef} playsInline muted onLoadedData={() => setCamReady(true)} className="h-full w-full -scale-x-100 object-cover" />
          {busy && <p className="absolute inset-x-0 bottom-0 bg-slate-900/70 py-2 text-center text-sm text-white">Hold still… {progress} of {SHOTS}</p>}
        </div>
        <p className="text-sm text-slate-600">Look straight at the camera in good light. This is done once; every check-in selfie is then compared with it.</p>
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree that my employer may store a face template (a set of numbers, not a photo) and use it only to verify my attendance. I can ask my admin to delete it.</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <Button className="w-full" onClick={register} loading={busy} disabled={!consent || !camReady || !modelReady}>
          <ScanFace className="h-4 w-4" /> {modelReady ? "Register my face" : "Preparing face check…"}
        </Button>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { Download, PlusSquare, Share, X } from "lucide-react";
import { promptInstall, useInstallState } from "../lib/install";
import { Button, Modal } from "./ui";

function IosSteps({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Install IWILL Attend on iPhone" onClose={onClose}>
      <ol className="space-y-3 text-sm text-slate-700">
        <li className="flex items-start gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
          <span>Open this page in <b>Safari</b>.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
          <span>Tap the <b>Share</b> button <Share className="inline h-4 w-4 text-brand-700" aria-label="Share icon" /> at the bottom (or top) of the screen.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">3</span>
          <span>Scroll down and tap <b>Add to Home Screen</b> <PlusSquare className="inline h-4 w-4 text-brand-700" aria-label="Add icon" />, then <b>Add</b>.</span>
        </li>
      </ol>
      <p className="mt-4 text-xs text-slate-500">IWILL Attend then opens from its icon like an app, full screen.</p>
      <Button className="mt-4 w-full" onClick={onClose}>Got it</Button>
    </Modal>
  );
}

/** "Install app" button. Shows only where installing is possible and not done yet. */
export function InstallButton({ variant = "button", className = "" }: { variant?: "button" | "link" | "icon"; className?: string }) {
  const state = useInstallState();
  const [ios, setIos] = useState(false);
  if (state === "installed" || state === "unavailable") return null;
  const go = () => (state === "ios" ? setIos(true) : void promptInstall());
  return (
    <>
      {variant === "icon" ? (
        <button onClick={go} aria-label="Install app" title="Install app" className={`rounded-lg p-2 text-slate-500 hover:bg-slate-100 ${className}`}>
          <Download className="h-5 w-5" />
        </button>
      ) : variant === "link" ? (
        <button onClick={go} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 ${className}`}>
          <Download className="h-4 w-4" /> Install app
        </button>
      ) : (
        <Button variant="outline" onClick={go} className={className}>
          <Download className="h-4 w-4" /> Install app
        </Button>
      )}
      {ios && <IosSteps onClose={() => setIos(false)} />}
    </>
  );
}

const DISMISS_KEY = "iwill-install-banner-dismissed";
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** After sign-in: a one-line offer to install the app on this device, which can be put off for 2 weeks. */
export function InstallBanner() {
  const state = useInstallState();
  const [hidden, setHidden] = useState(dismissedRecently);
  const [ios, setIos] = useState(false);
  if (hidden || state === "installed" || state === "unavailable") return null;
  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: just hide for now */
    }
    setHidden(true);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
      <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-lg bg-white" />
      <p className="min-w-0 flex-1 text-sm text-brand-900">
        <b>Install IWILL Attend</b> on this {state === "ios" ? "iPhone" : "device"} to open it from your home screen, like an app.
      </p>
      <Button onClick={() => (state === "ios" ? setIos(true) : void promptInstall())}>
        <Download className="h-4 w-4" /> Install
      </Button>
      <button onClick={later} aria-label="Not now" className="rounded-lg p-1.5 text-brand-700 hover:bg-brand-100">
        <X className="h-4 w-4" />
      </button>
      {ios && <IosSteps onClose={() => setIos(false)} />}
    </div>
  );
}

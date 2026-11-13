import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { selfieUrl } from "../lib/utils";

/** Shows a private selfie, fetched with the signed-in user's access. Click to enlarge. */
export function SelfieThumb({ path, size = 40 }: { path: string | null | undefined; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) void selfieUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!url) {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-slate-100 text-slate-400" style={{ width: size, height: size }}>
        <User className="h-1/2 w-1/2" />
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0" aria-label="View selfie">
        <img src={url} alt="Selfie" className="rounded-full object-cover ring-1 ring-slate-200" style={{ width: size, height: size }} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/80 p-6" onClick={() => setOpen(false)}>
          <img src={url} alt="Selfie" className="max-h-full max-w-full rounded-2xl" />
        </div>
      )}
    </>
  );
}

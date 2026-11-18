import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { PasswordInput } from "../pages/AuthPages";
import { Button, ErrorText, Modal } from "./ui";

/** Signed-in user changes their own password: current password first, then the new one twice. */
export function ChangePassword({ email, onClose }: { email: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("The two new passwords do not match.");
    if (next === current) return setError("The new password must be different from the current one.");
    setBusy(true);
    setError("");
    // Proves the person at the screen knows the current password.
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setBusy(false);
      return setError("The current password is not right.");
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true);
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">Your password has been changed. Use the new password next time you sign in.</p>
          <Button className="w-full" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <PasswordInput label="Current password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <PasswordInput label="New password" autoComplete="new-password" required minLength={8} maxLength={72} hint="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            hint={confirm && confirm !== next ? "Does not match the new password yet" : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" loading={busy}>Change password</Button>
        </form>
      )}
    </Modal>
  );
}

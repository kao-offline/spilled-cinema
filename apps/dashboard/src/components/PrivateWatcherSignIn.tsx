import { useId } from "react";
import { Fingerprint, LoaderCircle, LockKeyhole } from "lucide-react";
import type { PrivateNodeAccount } from "../lib/private-node-client";

type Props = {
  accounts: PrivateNodeAccount[];
  accountId: string;
  password: string;
  busy: boolean;
  message: string | null;
  onAccountChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordLogin: () => void;
  onPasskeyLogin: () => void;
  compact?: boolean;
};

export function PrivateWatcherSignIn(props: Props) {
  const id = useId();
  const account = props.accounts.find((item) => item.accountId === props.accountId);
  const fieldClass = `${props.compact ? "mt-1.5 min-h-11 rounded-[13px] px-3 text-sm" : "mt-2 min-h-13 rounded-xl px-4 text-base"} w-full border border-white/15 bg-[#101217] text-white outline-none focus:border-orange-200/60 focus:ring-2 focus:ring-orange-200/20 disabled:opacity-50`;
  return (
    <form className={`mx-auto w-full max-w-lg ${props.compact ? "py-1" : "py-3 sm:py-5"}`} aria-labelledby={`${id}-title`} aria-busy={props.busy} onSubmit={(event) => { event.preventDefault(); if (!props.busy) props.onPasswordLogin(); }}>
      <div className={props.compact ? "mb-4" : "mb-6"}>
        <LockKeyhole className={props.compact ? "mb-2 h-5 w-5 text-orange-200" : "mb-4 h-7 w-7 text-orange-200"} aria-hidden="true" />
        <h3 id={`${id}-title`} className={`${props.compact ? "text-lg" : "text-2xl"} font-bold tracking-tight text-white`}>Welcome to your private cinema</h3>
        <p className={`${props.compact ? "mt-1 text-xs leading-5" : "mt-2 text-sm leading-6"} text-white/65`}>Sign in to access your profiles and private downloads.</p>
      </div>
      <fieldset disabled={props.busy} className={props.compact ? "space-y-3" : "space-y-4"}>
        <legend className="sr-only">Watcher account credentials</legend>
        <label className="block text-sm font-semibold text-white/85">
          Account
          <select required autoComplete="username" name="username" value={props.accountId} onChange={(event) => props.onAccountChange(event.target.value)} className={fieldClass}>
            <option value="" disabled>Select your account</option>
            {props.accounts.map((item) => <option key={item.accountId} value={item.accountId}>{item.displayName}</option>)}
          </select>
        </label>
        {account?.hasPassword !== false ? <>
          <label className="block text-sm font-semibold text-white/85">
            Password
            <input required type="password" name="password" autoComplete="current-password" value={props.password} onChange={(event) => props.onPasswordChange(event.target.value)} className={fieldClass} aria-describedby={props.message ? `${id}-message` : undefined} />
          </label>
          <button type="submit" className={`${props.compact ? "min-h-11 rounded-[13px] text-sm" : "min-h-13 rounded-xl"} flex w-full items-center justify-center gap-2 bg-white px-5 font-bold text-[#141519] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50`}>
            {props.busy ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}{props.busy ? "Signing in…" : "Sign in"}
          </button>
        </> : <p className="text-sm text-white/65">This account uses a passkey.</p>}
        {account?.passkeyCount !== 0 ? <button type="button" onClick={props.onPasskeyLogin} className={`${props.compact ? "min-h-11 rounded-[13px] text-sm" : "min-h-13 rounded-xl"} flex w-full items-center justify-center gap-2 border border-white/20 bg-white/5 px-5 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50`}><Fingerprint className="h-5 w-5" aria-hidden="true" />Sign in with passkey</button> : null}
      </fieldset>
      {props.message ? <p id={`${id}-message`} className="mt-4 rounded-xl border border-white/15 bg-white/5 p-3 text-sm leading-6 text-white/85" role="status">{props.message}</p> : null}
    </form>
  );
}

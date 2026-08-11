import { ArrowLeft, Check, KeyRound, LockKeyhole, Server, ShieldCheck, Wifi } from "lucide-react";

const steps = [
  { icon: Server, title: "Install Spilled Server", body: "Run the Windows installer on the PC that holds your media. The new build listens only on that computer and does not create a public tunnel." },
  { icon: LockKeyhole, title: "Finish local setup", body: "Open Spilled Server from the tray, create the administrator, then add a watcher account with a password or passkey." },
  { icon: Wifi, title: "Connect from Home", body: "On any device, open Spilled Cinema, choose Private node on Home, and enter the 16-character connection code shown by your server." },
  { icon: KeyRound, title: "Sign in or manage", body: "Use a watcher password to stream, or choose Manage server and enter the local administrator password to edit the node from the app." },
];

export function PrivateNodeGuideView() {
  return (
    <main className="min-h-screen bg-[#07080b] text-white selection:bg-orange-300/30">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(251,146,60,.14),transparent_30%),radial-gradient(circle_at_90%_45%,rgba(52,211,153,.07),transparent_28%)]" />
      <div className="relative mx-auto max-w-5xl px-5 pb-20 pt-6 sm:px-10 sm:pt-10">
        <a href="/" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.22em] text-white/45 transition hover:text-white"><ArrowLeft size={15} /> Home</a>
        <section className="mt-12 max-w-3xl sm:mt-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.2em] text-emerald-200"><ShieldCheck size={14} /> Private by default</div>
          <h1 className="mt-6 text-5xl font-black leading-[.94] tracking-[-.055em] sm:text-7xl">Your cinema.<br /><span className="text-white/32">Not a public server.</span></h1>
          <p className="mt-6 max-w-2xl text-base font-medium leading-7 text-white/48">Remote access uses an outbound encrypted gateway connection, so you never need to expose an IP address, open a router port, or remember a tunnel URL.</p>
        </section>

        <section className="mt-14 grid gap-3 sm:grid-cols-2">
          {steps.map((step, index) => <article key={step.title} className="rounded-[24px] border border-white/[.08] bg-white/[.035] p-5 shadow-[0_20px_60px_rgba(0,0,0,.22)]"><div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[.07] text-orange-200"><step.icon size={20} /></span><span className="font-mono text-xs font-bold text-white/18">0{index + 1}</span></div><h2 className="mt-5 text-xl font-black tracking-[-.025em]">{step.title}</h2><p className="mt-2 text-sm font-medium leading-6 text-white/42">{step.body}</p></article>)}
        </section>

        <section className="mt-14 overflow-hidden rounded-[28px] border border-white/[.08] bg-[#0d0f13]">
          <div className="border-b border-white/[.07] px-6 py-5"><h2 className="text-xl font-black">What “private” means</h2><p className="mt-1 text-sm text-white/38">The honest boundary of private remote mode.</p></div>
          <div className="divide-y divide-white/[.06]">
            {[
              ["No inbound public URL", "The server binds to 127.0.0.1 and automatic public tunnels are disabled."],
              ["No anonymous public capabilities", "Search, playback, downloads, and library access require an authenticated watcher session."],
              ["End-to-end protected RPC", "The gateway relays encrypted requests; your node decrypts and answers them."],
              ["Small control-plane footprint", "Node identity, reachability, and capability health are registered so your browser can find it. Media and passwords stay on your node."],
            ].map(([title, body]) => <div key={title} className="flex gap-4 px-6 py-5"><Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div><div className="text-sm font-black">{title}</div><div className="mt-1 text-sm leading-6 text-white/40">{body}</div></div></div>)}
          </div>
        </section>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row"><a href="/connect" className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-black text-black">Connect a private node</a><a href="/node/setup" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/[.035] px-7 text-sm font-black text-white/70">Open local setup</a></div>
      </div>
    </main>
  );
}

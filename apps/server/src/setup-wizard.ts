type SetupWizardInput = {
  setupCode: string;
  setupRequired: boolean;
  suggestedNodeName: string;
};

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderSetupWizard(input: SetupWizardInput) {
  const bootstrap = jsonForScript(input);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Set up Spilled Server</title>
  <style>
    :root{--ink:#0a0a09;--panel:#151411;--line:#343029;--paper:#eee9dc;--muted:#a8a194;--orange:#ff5a1f;--amber:#ffc15a;--green:#74d89b}
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;background:var(--ink);color:var(--paper)}
    body{font-family:"Aptos","Segoe UI",sans-serif;background:
      radial-gradient(circle at 78% 10%,rgba(255,90,31,.16),transparent 27rem),
      repeating-linear-gradient(90deg,transparent 0 79px,rgba(255,255,255,.025) 80px),
      var(--ink)}
    button,input{font:inherit}
    button{cursor:pointer}
    .shell{width:min(1080px,calc(100% - 32px));margin:0 auto;padding:28px 0 50px}
    .mast{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:18px}
    .brand{display:flex;align-items:center;gap:13px;font:900 14px/1 "Arial Narrow","Aptos Display",sans-serif;letter-spacing:.22em;text-transform:uppercase}
    .mark{width:32px;height:32px;border:2px solid var(--orange);border-radius:50%;position:relative;box-shadow:inset 0 0 0 7px var(--ink)}
    .mark:after{content:"";position:absolute;width:7px;height:7px;border-radius:50%;background:var(--orange);inset:50% auto auto 50%;transform:translate(-50%,-50%)}
    .status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;font-weight:700}
    .status i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 14px var(--green)}
    .layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:34px;padding-top:46px}
    .rail{position:relative}
    .rail:before{content:"";position:absolute;left:15px;top:18px;bottom:18px;width:1px;background:var(--line)}
    .step-label{position:relative;display:flex;align-items:center;gap:15px;min-height:64px;color:#6e685f;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}
    .step-label b{z-index:1;display:grid;place-items:center;width:31px;height:31px;border-radius:50%;border:1px solid var(--line);background:var(--ink);font-size:11px}
    .step-label.active{color:var(--paper)}.step-label.active b{border-color:var(--orange);background:var(--orange);color:#090909}
    .step-label.done{color:var(--muted)}.step-label.done b{border-color:var(--green);color:var(--green)}
    .card{min-height:570px;border:1px solid var(--line);border-radius:3px;background:linear-gradient(145deg,rgba(255,255,255,.035),transparent 50%),var(--panel);box-shadow:0 32px 90px rgba(0,0,0,.38);overflow:hidden}
    .frame{padding:clamp(28px,6vw,70px)}
    .eyebrow{color:var(--orange);font:900 11px/1 "Arial Narrow","Aptos Display",sans-serif;letter-spacing:.28em;text-transform:uppercase}
    h1{max-width:720px;margin:16px 0 14px;font:900 clamp(38px,6vw,76px)/.92 Georgia,serif;letter-spacing:-.055em}
    h2{margin:12px 0;font:900 clamp(30px,4vw,52px)/1 Georgia,serif;letter-spacing:-.04em}
    .lead{max-width:630px;color:var(--muted);font-size:17px;line-height:1.65}
    .assurance{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:38px 0}
    .assurance div{border-top:1px solid var(--line);padding:15px 4px;color:var(--muted);font-size:13px;line-height:1.45}
    .assurance strong{display:block;margin-bottom:5px;color:var(--paper);font-size:13px}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}
    .primary,.secondary{border:0;border-radius:2px;padding:14px 20px;font-weight:900}
    .primary{background:var(--orange);color:#0a0a09;box-shadow:0 8px 30px rgba(255,90,31,.22)}
    .primary:hover{background:#ff713f}.primary:disabled{opacity:.45;cursor:not-allowed}
    .secondary{background:transparent;color:var(--paper);border:1px solid var(--line)}
    .field{display:grid;gap:8px;margin-top:22px}
    .field label{font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    .field input{width:100%;border:1px solid var(--line);border-radius:2px;background:#090908;color:var(--paper);padding:15px 16px;outline:none}
    .field input:focus{border-color:var(--amber);box-shadow:0 0 0 3px rgba(255,193,90,.1)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .choices{display:grid;gap:10px;margin-top:28px}
    .choice{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;border:1px solid var(--line);padding:16px;background:#0e0e0c}
    .choice strong{display:block;font-size:15px}.choice small{display:block;margin-top:4px;color:var(--muted);line-height:1.45}
    .switch{appearance:none;width:45px;height:25px;border-radius:20px;background:#3b3730;position:relative;transition:.2s}
    .switch:after{content:"";position:absolute;width:19px;height:19px;border-radius:50%;background:var(--paper);top:3px;left:3px;transition:.2s}
    .switch:checked{background:var(--orange)}.switch:checked:after{left:23px;background:#111}
    .notice{margin-top:22px;border-left:3px solid var(--amber);background:rgba(255,193,90,.07);padding:14px 16px;color:#d8cfbf;font-size:13px;line-height:1.5}
    .error{display:none;margin-top:18px;border:1px solid rgba(255,90,31,.4);background:rgba(255,90,31,.1);padding:13px;color:#ffd8ca;font-weight:700}
    .finish{display:grid;place-items:center;text-align:center;min-height:430px}
    .check{display:grid;place-items:center;width:72px;height:72px;border-radius:50%;background:var(--green);color:#08130c;font-size:36px;font-weight:900;margin:0 auto 23px}
    .fine{color:#777167;font-size:12px;margin-top:16px}
    [hidden]{display:none!important}
    @media(max-width:760px){.layout{grid-template-columns:1fr;padding-top:25px}.rail{display:flex;overflow:auto}.rail:before{display:none}.step-label{min-width:110px;min-height:45px}.step-label span{display:none}.assurance,.grid2{grid-template-columns:1fr}.frame{padding:30px 22px}.card{min-height:0}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="mast">
      <div class="brand"><span class="mark"></span>Spilled Server</div>
      <div class="status"><i></i> Server running on this PC</div>
    </header>
    <div class="layout">
      <aside class="rail" aria-label="Setup progress">
        <div class="step-label active" data-label="0"><b>1</b><span>Welcome</span></div>
        <div class="step-label" data-label="1"><b>2</b><span>Owner</span></div>
        <div class="step-label" data-label="2"><b>3</b><span>Sharing</span></div>
        <div class="step-label" data-label="3"><b>4</b><span>Ready</span></div>
      </aside>
      <section class="card">
        <div class="frame" data-step="0">
          <div class="eyebrow">First run</div>
          <h1>Your spare PC just became a Spilled node.</h1>
          <p class="lead">The difficult parts are already handled. Storage is protected by Windows, the server stays private by default, and it will start automatically when you sign in.</p>
          <div class="assurance">
            <div><strong>No router changes</strong>No ports or firewall rules to configure.</div>
            <div><strong>No library app</strong>This computer runs only the server process.</div>
            <div><strong>Owner controlled</strong>You choose what—if anything—it contributes.</div>
          </div>
          <div class="actions"><button class="primary" data-next>Set up my server →</button></div>
        </div>
        <div class="frame" data-step="1" hidden>
          <div class="eyebrow">Owner & server</div>
          <h2>Make it yours.</h2>
          <p class="lead">Use a name you will recognize. Your owner password stays on this PC and protects server settings.</p>
          <div class="field"><label for="nodeName">Server name</label><input id="nodeName" autocomplete="organization"></div>
          <div class="field"><label for="ownerName">Your name</label><input id="ownerName" value="Owner" autocomplete="name"></div>
          <div class="grid2">
            <div class="field"><label for="password">Owner password</label><input id="password" type="password" minlength="10" autocomplete="new-password" placeholder="At least 10 characters"></div>
            <div class="field"><label for="confirm">Confirm password</label><input id="confirm" type="password" minlength="10" autocomplete="new-password"></div>
          </div>
          <div class="notice">Use a password you do not use anywhere else. Passkey and recovery setup can be completed from Server Admin after this first run.</div>
          <div class="error" id="ownerError"></div>
          <div class="actions"><button class="secondary" data-back>Back</button><button class="primary" id="ownerNext">Continue →</button></div>
        </div>
        <div class="frame" data-step="2" hidden>
          <div class="eyebrow">Contribution</div>
          <h2>What may this PC help with?</h2>
          <p class="lead">Local and private activity always has priority. You can change these choices later.</p>
          <div class="choices">
            <label class="choice"><span><strong>Search and refresh catalogs</strong><small>Help find new films, seasons, and episodes and keep provider data current.</small></span><input class="switch" id="search" type="checkbox" checked></label>
            <label class="choice"><span><strong>Resolve players</strong><small>Help turn supported provider pages into working playback sources.</small></span><input class="switch" id="resolve" type="checkbox" checked></label>
            <label class="choice"><span><strong>Temporary download acceleration</strong><small>Use limited temporary disk and bandwidth. Nothing is added to your library.</small></span><input class="switch" id="download" type="checkbox"></label>
            <label class="choice"><span><strong>SpillShare</strong><small>Share eligible completed downloads. Disabled unless you explicitly enable it.</small></span><input class="switch" id="spillshare" type="checkbox"></label>
          </div>
          <div class="notice">Public contribution only activates after the managed gateway is connected and automated verification passes. Your paths, accounts, and library structure are never advertised.</div>
          <div class="error" id="finishError"></div>
          <div class="actions"><button class="secondary" data-back>Back</button><button class="primary" id="finish">Finish setup</button></div>
          <div class="fine">The setup token is used automatically and never leaves this computer except in this protected local request.</div>
        </div>
        <div class="frame finish" data-step="3" hidden>
          <div>
            <div class="check">✓</div>
            <div class="eyebrow">Setup complete</div>
            <h2>Server ready.</h2>
            <p class="lead">You can close this page. Spilled Server will keep running in the background and start with Windows.</p>
            <div class="actions" style="justify-content:center"><button class="primary" onclick="location.href='/v2/health/ready'">Check server health</button></div>
          </div>
        </div>
      </section>
    </div>
  </main>
  <script>
    const bootstrap=${bootstrap};
    let step=bootstrap.setupRequired?0:3;
    const show=(next)=>{
      step=next;
      document.querySelectorAll("[data-step]").forEach((el)=>el.hidden=Number(el.dataset.step)!==step);
      document.querySelectorAll("[data-label]").forEach((el)=>{
        const index=Number(el.dataset.label);
        el.classList.toggle("active",index===step);
        el.classList.toggle("done",index<step);
        if(index<step)el.querySelector("b").textContent="✓";
      });
    };
    document.getElementById("nodeName").value=bootstrap.suggestedNodeName;
    document.querySelectorAll("[data-next]").forEach((button)=>button.onclick=()=>show(step+1));
    document.querySelectorAll("[data-back]").forEach((button)=>button.onclick=()=>show(Math.max(0,step-1)));
    document.getElementById("ownerNext").onclick=()=>{
      const password=document.getElementById("password").value;
      const confirm=document.getElementById("confirm").value;
      const error=document.getElementById("ownerError");
      error.style.display="none";
      if(password.length<10){error.textContent="Choose a password with at least 10 characters.";error.style.display="block";return}
      if(password!==confirm){error.textContent="The two passwords do not match.";error.style.display="block";return}
      show(2);
    };
    document.getElementById("finish").onclick=async()=>{
      const button=document.getElementById("finish");
      const error=document.getElementById("finishError");
      button.disabled=true;button.textContent="Securing server…";error.style.display="none";
      const ownerName=document.getElementById("ownerName").value.trim()||"Owner";
      const safeOwner=ownerName.toLowerCase().replace(/[^a-z0-9_-]/g,"_").replace(/_+/g,"_")||"owner";
      const search=document.getElementById("search").checked;
      try{
        const response=await fetch("/api/node/setup/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          setupCode:bootstrap.setupCode,
          dashboardOrigin:location.origin,
          nodeName:document.getElementById("nodeName").value.trim()||bootstrap.suggestedNodeName,
          admin:{adminId:"owner",displayName:ownerName,password:document.getElementById("password").value},
          publicCapabilities:{fetch:search,search,import:search,stream:document.getElementById("resolve").checked,download:document.getElementById("download").checked,spillshare:document.getElementById("spillshare").checked,relay:false},
          initialWatchers:[{watcherId:"watcher_"+safeOwner,displayName:ownerName,quotaBytes:536870912000,profiles:[{profileId:"prof_owner",displayName:ownerName,avatar:"default"}]}]
        })});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error||"Setup could not be completed.");
        show(3);
      }catch(reason){
        error.textContent=reason instanceof Error?reason.message:"Setup could not be completed.";
        error.style.display="block";button.disabled=false;button.textContent="Finish setup";
      }
    };
    show(step);
  </script>
</body>
</html>`;
}

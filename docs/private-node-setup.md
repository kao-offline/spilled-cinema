# Private node setup

This setup keeps the Windows server off the public web while allowing authenticated remote access through Spilled's encrypted gateway.

## Install and prepare the node

1. Install the current Spilled Server Windows build on the PC that stores your media.
2. Open Spilled Server from the Windows tray and finish local setup.
3. Create the administrator account, then add at least one watcher account.
4. Give the watcher a password or register a passkey. Do not share the administrator login for normal viewing.
5. Copy the 16-character connection code shown by the server.

The Windows build binds to `127.0.0.1`, disables automatic public tunnels, and exposes no anonymous public capabilities. Do not add router port-forwarding or a public reverse proxy.

## Connect a browser or phone

1. Open Spilled Cinema and choose **Private node** on Home.
2. Enter the connection code. On the server PC, **Find on this device** can fill it automatically.
3. Select the watcher and profile.
4. Sign in with the watcher's password or passkey.

The connection code locates a node; it is not a password. Authentication happens on the node. The browser saves the node identity and session so Home can reconnect without asking for a URL.

## Manage the server from the app

1. Connect the private node from Home once so the app remembers its identity.
2. Open **Private node**, then choose **Manage server**. You can also open `/node/admin` directly.
3. The saved connection code is filled automatically. Enter the administrator name created during setup (the Windows wizard defaults to `owner`) and its password.
4. From Server management you can inspect storage and sessions, create watcher accounts and profiles, and edit capabilities.

Management uses encrypted gateway RPC. The app does not need the PC's IP address, a LAN scan, or a public URL. Every edit requires an administrator session issued by the node.

## Test beta.28 before installing it everywhere

On the server PC:

1. Install `Spilled-Server-Setup-0.2.0-beta.28-x64.exe` and let Spilled Server start.
2. Open the tray menu and select **Check server health**. The browser should show `{"status":"ok"}`.
3. Select **Open setup and settings** and confirm the server shows its connection code.
4. In Windows PowerShell, run `Get-NetTCPConnection -LocalPort 8787 -State Listen`. The local address must be `127.0.0.1`, not `0.0.0.0`.

On another device or browser:

1. Open Spilled Cinema and choose **Private node** on Home.
2. Enter the connection code and sign in as a watcher. Confirm Home changes to the connected state.
3. Play a title or request a library refresh to confirm encrypted remote RPC works.
4. Choose **Manage server**, enter the administrator password, create a disposable test watcher, refresh the page, and confirm it remains listed.
5. Leave its public capability switches off unless you deliberately want public sharing.

Expected privacy checks:

- No router port forwarding is required.
- The server has no public tunnel URL.
- Port 8787 is reachable only from the server PC.
- A connection code alone cannot sign in as a watcher or administrator.
- An incorrect administrator password is rejected without changing server state.

Developer verification commands from the repository root:

```powershell
npm run test:private-node-connection -w @spilledcinema/dashboard
npm run test:private-node-admin -w @spilledcinema/dashboard
npm run test:private-node-admin -w @spilledcinema/dashboard -- --self-test-failure
npm run test:privacy-defaults -w @spilledcinema/server-windows
npm run build -w @spilledcinema/dashboard
npm run dist:windows -w @spilledcinema/server-windows
```

## Privacy boundary

- The node has no inbound public URL and no automatic tunnel.
- Remote RPC travels through an outbound gateway connection and is encrypted between the browser and node.
- The control plane stores node identity, reachability, and capability-health metadata required for discovery.
- Passwords, passkeys, library records, and media remain on the node.
- For an entirely offline/local-only node, set `SPILLED_DISABLE_MANAGED_GATEWAY=1`; remote connection codes will not work in that mode.

## Troubleshooting

- **Node not found:** make sure Spilled Server is running and the server PC has outbound internet access.
- **Setup not finished:** open local setup from the server tray and create a watcher.
- **Sign-in failed:** use the watcher's password, not the administrator password, or try its registered passkey.
- **Old server asks for a URL:** update the Windows server build. Manual URLs are retained only for compatibility with older nodes.

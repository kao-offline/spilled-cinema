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

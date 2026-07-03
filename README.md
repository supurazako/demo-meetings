# Demo Meetings

TURN relay 固定の WebRTC meeting デモアプリです。通信品質の劣化は
`rtc-emulator` 側で TURN 経路に対して行う前提です。

## Run

```bash
npm install
npm run demo
```

`npm run demo` starts coturn with Docker Compose, then starts the Vite app and
the signaling server. Stop it with `Ctrl+C`.

If you also want to run a configured Cloudflare Tunnel in the same terminal:

```bash
npm run demo:tunnel
```

TURN only, for running coturn on a VPS:

```bash
cp .env.example .env.local
# edit .env.local
npm install
npm run turn:up
```

Cloudflare Tunnel 経由の展示URL例:

```text
https://<meeting-hostname>/?room=demo
```

別PCのブラウザから以下を開きます。

```text
http://<demo-host-ip>:5173/?room=demo
```

signaling server は `ws://<demo-host-ip>:3001`、TURN は
`turn:<demo-host-ip>:3478` をデフォルトで使います。
HTTPSで開いた場合、signaling は同一originの `/ws` を使います。

## Environment

必要に応じて接続先を変更できます。

```bash
VITE_SIGNALING_URL=ws://192.168.10.20:3001 \
VITE_TURN_URL=turn:192.168.10.20:3478 \
VITE_TURN_USERNAME=demo \
VITE_TURN_CREDENTIAL=demo-password \
npm run dev
```

WebRTC は `iceTransportPolicy: "relay"` に固定しています。TURN が停止している
場合、参加者同士は接続できません。

## Ports and traffic

| Purpose | Default endpoint | Notes |
| --- | --- | --- |
| Web app | `127.0.0.1:5173` | Vite dev server. Expose this through HTTPS for real devices. |
| Signaling | `127.0.0.1:3001` | WebSocket signaling server. Expose this as `/ws` when using a tunnel/reverse proxy. |
| TURN control | `${TURN_HOST}:${TURN_PORT}` | Local coturn server. Browsers allocate relay candidates here. |
| TURN media relay | `${TURN_HOST}:${TURN_MIN_PORT}-${TURN_MAX_PORT}` | Relayed audio/video packets use these UDP source ports. |

The browser receives the TURN server from Vite env:

```bash
TURN_HOST=192.0.2.10
TURN_PORT=3478
TURN_MIN_PORT=50000
TURN_MAX_PORT=50100

VITE_TURN_URL=turn:${TURN_HOST}:${TURN_PORT}
VITE_TURN_USERNAME=demo
VITE_TURN_CREDENTIAL=demo-password
```

`VITE_TURN_URL` is consumed by `buildIceServers()` in the client. If it is not
set, the app falls back to `turn:<current-hostname>:3478`.

## External network access

Cloudflare Tunnel can expose only the web app and signaling path. TURN media
traffic must be reachable directly from participant browsers.

Recommended setup for users outside the local LAN:

1. Run coturn on a public VPS, or port-forward TURN from a public router to the
   demo host.
2. Open UDP `3478` and UDP `${TURN_MIN_PORT}-${TURN_MAX_PORT}`.
3. Point the browser to the public TURN address:

```bash
TURN_HOST=0.0.0.0
TURN_EXTERNAL_IP=203.0.113.10
TURN_PORT=3478
TURN_MIN_PORT=50000
TURN_MAX_PORT=50100

VITE_TURN_URL=turn:${TURN_EXTERNAL_IP}:${TURN_PORT}
VITE_TURN_USERNAME=demo
VITE_TURN_CREDENTIAL=demo-password
```

When `TURN_EXTERNAL_IP` is set, `npm run demo` writes coturn
`external-ip=<public-ip>/<local-listen-ip>` so relay candidates advertise the
public address. If the network is behind CGNAT and no public inbound UDP can be
forwarded, use a public VPS for TURN.

On a VPS, this repository can run only coturn:

```bash
git clone https://github.com/example/demo-meetings.git
cd demo-meetings
cp .env.example .env.local
# edit .env.local: TURN_EXTERNAL_IP, VITE_TURN_URL, username, credential
npm install
npm run turn:up
```

Open these firewall/security-group ports on the VPS:

```text
UDP 3478
UDP 50000-50100
```

`npm run turn:config` only generates `.tmp/turnserver.conf` without starting
Docker Compose. `npm run turn:down` stops coturn.

## Impair TURN media traffic

To degrade the actual meeting media for the current local demo, impair outgoing
UDP packets from the local TURN server. Set these values for the current venue
before applying impairment:

```bash
NET_IF=eth0
TURN_PORT=3478
TURN_MIN_PORT=50000
TURN_MAX_PORT=50100
DELAY=200ms
JITTER=50ms
LOSS=5%
RATE=800kbit
```

Apply impairment:

```bash
sudo tc qdisc del dev "$NET_IF" root 2>/dev/null || true

sudo tc qdisc add dev "$NET_IF" root handle 1: prio

sudo tc qdisc add dev "$NET_IF" parent 1:3 handle 30: netem \
  delay "$DELAY" "$JITTER" \
  loss "$LOSS" \
  rate "$RATE"

sudo tc filter add dev "$NET_IF" protocol ip parent 1:0 prio 3 u32 \
  match ip protocol 17 0xff \
  match ip sport "$TURN_MIN_PORT" 0xc000 \
  flowid 1:3
```

This targets UDP packets whose source port is in the configured TURN relay port
range. With the default `50000-50100` range, the `0xc000` mask covers
`49152-65535`, which includes the relay range. Audio and video are both affected.

Check current rules:

```bash
tc qdisc show dev "$NET_IF"
tc filter show dev "$NET_IF" parent 1:
```

Clear impairment:

```bash
sudo tc qdisc del dev "$NET_IF" root
```

## Cloudflare Tunnel

Example ingress:

```yaml
- hostname: <meeting-hostname>
  path: /ws
  service: http://127.0.0.1:3001
- hostname: <meeting-hostname>
  service: http://127.0.0.1:5173
```

DNS route example:

```bash
TUNNEL_NAME=my-tunnel
MEETING_HOSTNAME=meet.example.com

cloudflared tunnel route dns "$TUNNEL_NAME" "$MEETING_HOSTNAME"
```

Allow the tunnel hostname in Vite dev server:

```bash
VITE_ALLOWED_HOSTS="$MEETING_HOSTNAME" npm run dev
```

or put it in `.env.local`:

```bash
VITE_ALLOWED_HOSTS=meet.example.com
```

TURN traffic does not go through Cloudflare Tunnel. For local demos, set
`.env.local` so the browser points to the TURN address reachable from the
participant devices.

## Notes for real devices

- 別PCの実カメラ/マイクを使う場合、ブラウザの制約により HTTPS が必要です。
  `http://localhost:5173` では許可ダイアログが出ますが、
  `http://<demo-host-ip>:5173` では通常出ません。
- カメラが存在しない場合は擬似映像にフォールバックします。権限ブロックやHTTP由来
  の失敗は画面に理由を表示します。
- デモ時は `chrome://webrtc-internals` などで candidate pair が `relay` に
  なっていることを確認してください。
- `rtc-emulator` 側で TURN までの経路、または TURN から参加者への経路を劣化
  させることで、実際の会議映像/音声の悪化を確認できます。

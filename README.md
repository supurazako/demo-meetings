# Demo Meetings

TURN relay 固定の WebRTC meeting デモアプリです。通信品質の劣化は
`rtc-emulator` 側で TURN 経路に対して行う前提です。

## Run

```bash
npm install
docker compose up -d turn
npm run dev
```

別PCのブラウザから以下を開きます。

```text
http://<demo-host-ip>:5173/?room=demo
```

signaling server は `ws://<demo-host-ip>:3001`、TURN は
`turn:<demo-host-ip>:3478` をデフォルトで使います。

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

## Notes for real devices

- 別PCの実カメラ/マイクを使う場合、ブラウザの制約により HTTPS が必要になる
  ことがあります。許可されない場合、このアプリは擬似映像にフォールバックします。
- デモ時は `chrome://webrtc-internals` などで candidate pair が `relay` に
  なっていることを確認してください。
- `rtc-emulator` 側で TURN までの経路、または TURN から参加者への経路を劣化
  させることで、実際の会議映像/音声の悪化を確認できます。

import {
  Camera,
  CameraOff,
  LogIn,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  RadioTower,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMeetingMedia } from "./media";
import {
  ClientMessage,
  PeerInfo,
  ServerMessage,
  signalingUrl,
} from "./signaling";

type PeerView = PeerInfo & {
  stream?: MediaStream;
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
};

type PeerRuntime = PeerView & {
  pc: RTCPeerConnection;
};

type JoinState = "idle" | "joining" | "joined" | "error";

const defaultRoom = new URLSearchParams(window.location.search).get("room") ?? "demo";

export function App() {
  const [name, setName] = useState(() => `Guest ${Math.floor(Math.random() * 900 + 100)}`);
  const [roomId, setRoomId] = useState(defaultRoom);
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [error, setError] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerRuntime>());
  const selfIdRef = useRef("");

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const syncPeers = useCallback(() => {
    setPeers(
      [...peersRef.current.values()].map(
        ({ id, name: peerName, stream, connectionState, iceState }) => ({
          id,
          name: peerName,
          stream,
          connectionState,
          iceState,
        }),
      ),
    );
  }, []);

  const createPeer = useCallback(
    (peer: PeerInfo) => {
      const existing = peersRef.current.get(peer.id);
      if (existing) {
        return existing;
      }

      const pc = new RTCPeerConnection({
        iceServers: buildIceServers(),
        iceTransportPolicy: "relay",
      });

      for (const track of localStreamRef.current?.getTracks() ?? []) {
        pc.addTrack(track, localStreamRef.current!);
      }

      const runtime: PeerRuntime = {
        ...peer,
        pc,
        connectionState: pc.connectionState,
        iceState: pc.iceConnectionState,
      };

      pc.ontrack = (event) => {
        runtime.stream = event.streams[0];
        syncPeers();
      };
      pc.onconnectionstatechange = () => {
        runtime.connectionState = pc.connectionState;
        syncPeers();
      };
      pc.oniceconnectionstatechange = () => {
        runtime.iceState = pc.iceConnectionState;
        syncPeers();
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            type: "ice-candidate",
            targetId: peer.id,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      peersRef.current.set(peer.id, runtime);
      syncPeers();
      return runtime;
    },
    [send, syncPeers],
  );

  const callPeer = useCallback(
    async (peer: PeerInfo) => {
      const runtime = createPeer(peer);
      const offer = await runtime.pc.createOffer();
      await runtime.pc.setLocalDescription(offer);
      send({ type: "offer", targetId: peer.id, description: offer });
    },
    [createPeer, send],
  );

  const handleMessage = useCallback(
    async (message: ServerMessage) => {
      if (message.type === "welcome") {
        selfIdRef.current = message.id;
        setJoinState("joined");
        for (const peer of message.peers) {
          createPeer(peer);
        }
        return;
      }

      if (message.type === "peer-joined") {
        await callPeer(message.peer);
        return;
      }

      if (message.type === "peer-left") {
        const runtime = peersRef.current.get(message.id);
        runtime?.pc.close();
        peersRef.current.delete(message.id);
        syncPeers();
        return;
      }

      if (message.type === "offer") {
        const runtime = createPeer({ id: message.fromId, name: "Guest" });
        await runtime.pc.setRemoteDescription(message.description);
        const answer = await runtime.pc.createAnswer();
        await runtime.pc.setLocalDescription(answer);
        send({ type: "answer", targetId: message.fromId, description: answer });
        return;
      }

      if (message.type === "answer") {
        const runtime = peersRef.current.get(message.fromId);
        if (runtime) {
          await runtime.pc.setRemoteDescription(message.description);
        }
        return;
      }

      if (message.type === "ice-candidate") {
        const runtime = peersRef.current.get(message.fromId);
        if (runtime) {
          await runtime.pc.addIceCandidate(message.candidate);
        }
        return;
      }

      if (message.type === "error") {
        setError(message.message);
      }
    },
    [callPeer, createPeer, send, syncPeers],
  );

  const join = useCallback(async () => {
    setError("");
    setJoinState("joining");
    try {
      const stream = await getMeetingMedia();
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
      setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));

      const socket = new WebSocket(signalingUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "join",
            roomId,
            name,
          } satisfies ClientMessage),
        );
      };
      socket.onmessage = (event) => {
        void handleMessage(JSON.parse(event.data) as ServerMessage);
      };
      socket.onerror = () => {
        setError("Signaling server is unreachable.");
        setJoinState("error");
      };
      socket.onclose = () => {
        if (joinState === "joined") {
          setError("Signaling connection closed.");
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join meeting.");
      setJoinState("error");
    }
  }, [handleMessage, joinState, name, roomId]);

  const leave = useCallback(() => {
    send({ type: "leave" });
    socketRef.current?.close();
    socketRef.current = null;
    for (const runtime of peersRef.current.values()) {
      runtime.pc.close();
    }
    peersRef.current.clear();
    syncPeers();
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    localStreamRef.current = null;
    setLocalStream(null);
    setJoinState("idle");
    setScreenSharing(false);
  }, [send, syncPeers]);

  const toggleMic = () => {
    const next = !micEnabled;
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = next;
    }
    setMicEnabled(next);
  };

  const toggleSpeaker = () => {
    setSpeakerEnabled((enabled) => !enabled);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    for (const track of localStreamRef.current?.getVideoTracks() ?? []) {
      track.enabled = next;
    }
    setCameraEnabled(next);
  };

  const shareScreen = async () => {
    if (screenSharing) {
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const [screenTrack] = display.getVideoTracks();
    if (!screenTrack) {
      return;
    }
    replaceVideoTrack(screenTrack, peersRef.current);
    screenTrack.onended = () => {
      const [cameraTrack] = localStreamRef.current?.getVideoTracks() ?? [];
      if (cameraTrack) {
        replaceVideoTrack(cameraTrack, peersRef.current);
      }
      setScreenSharing(false);
    };
    setScreenSharing(true);
  };

  useEffect(() => leave, [leave]);

  const remoteTiles = useMemo(
    () =>
      peers.map((peer) => ({
        ...peer,
        status: peerLabel(peer),
      })),
    [peers],
  );

  const connectedCount = remoteTiles.filter(
    (peer) => peer.connectionState === "connected",
  ).length;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <span className="product">Demo Meetings</span>
          <span className="room-name">{roomId}</span>
        </div>
        <div className="connection-pill">
          <RadioTower size={16} />
          TURN relay only
        </div>
      </header>

      <main className="meeting-layout">
        <section className="stage" aria-label="Meeting participants">
          {joinState === "idle" || joinState === "error" ? (
            <JoinPanel
              name={name}
              roomId={roomId}
              joinState={joinState}
              error={error}
              onNameChange={setName}
              onRoomChange={setRoomId}
              onJoin={() => void join()}
            />
          ) : (
            <div className="video-grid">
              <VideoTile
                name={`${name} (you)`}
                stream={localStream}
                muted
                status={joinState === "joining" ? "Joining..." : "Local preview"}
              />
              {remoteTiles.map((peer) => (
                <VideoTile
                  key={peer.id}
                  name={peer.name}
                  stream={peer.stream}
                  muted={!speakerEnabled}
                  status={peer.status}
                />
              ))}
              {remoteTiles.length === 0 && (
                <div className="empty-seat">
                  <Users size={28} />
                  <span>Waiting for another participant</span>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="side-panel">
          <div>
            <h2>Participants</h2>
            <div className="participant-row">
              <span>{name}</span>
              <strong>You</strong>
            </div>
            {remoteTiles.map((peer) => (
              <div className="participant-row" key={peer.id}>
                <span>{peer.name}</span>
                <strong>{peer.connectionState}</strong>
              </div>
            ))}
          </div>
          <div className="status-box">
            <span>Relay path</span>
            <strong>{connectedCount}/{remoteTiles.length} connected</strong>
          </div>
        </aside>
      </main>

      <footer className="controls">
        <button
          type="button"
          className="icon-button"
          onClick={toggleMic}
          disabled={joinState !== "joined"}
          aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          title={micEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          {micEnabled ? <Mic /> : <MicOff />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={toggleSpeaker}
          disabled={joinState !== "joined"}
          aria-label={speakerEnabled ? "Mute speaker" : "Unmute speaker"}
          title={speakerEnabled ? "Mute speaker" : "Unmute speaker"}
        >
          {speakerEnabled ? <Volume2 /> : <VolumeX />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={toggleCamera}
          disabled={joinState !== "joined"}
          aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
          title={cameraEnabled ? "Turn camera off" : "Turn camera on"}
        >
          {cameraEnabled ? <Camera /> : <CameraOff />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void shareScreen()}
          disabled={joinState !== "joined"}
          aria-label="Share screen"
          title="Share screen"
        >
          <MonitorUp />
        </button>
        {joinState === "joined" || joinState === "joining" ? (
          <button type="button" className="leave-button" onClick={leave}>
            <PhoneOff size={20} />
            Leave
          </button>
        ) : (
          <button type="button" className="join-button compact" onClick={() => void join()}>
            <LogIn size={20} />
            Join
          </button>
        )}
        {joinState === "joined" && (
          <button type="button" className="ghost-button" onClick={leave}>
            <LogOut size={18} />
            Reset
          </button>
        )}
      </footer>
    </div>
  );
}

function JoinPanel({
  name,
  roomId,
  joinState,
  error,
  onNameChange,
  onRoomChange,
  onJoin,
}: {
  name: string;
  roomId: string;
  joinState: JoinState;
  error: string;
  onNameChange: (value: string) => void;
  onRoomChange: (value: string) => void;
  onJoin: () => void;
}) {
  return (
    <div className="join-panel">
      <div className="join-preview">
        <div className="avatar-mark">{initials(name)}</div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onJoin();
        }}
      >
        <label>
          Name
          <input value={name} onChange={(event) => onNameChange(event.target.value)} />
        </label>
        <label>
          Room
          <input value={roomId} onChange={(event) => onRoomChange(event.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="join-button" type="submit" disabled={joinState === "joining"}>
          <LogIn size={20} />
          Join meeting
        </button>
      </form>
    </div>
  );
}

function VideoTile({
  name,
  stream,
  muted = false,
  status,
}: {
  name: string;
  stream?: MediaStream | null;
  muted?: boolean;
  status: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-tile">
      {stream ? (
        <video ref={ref} autoPlay playsInline muted={muted} />
      ) : (
        <div className="avatar-mark">{initials(name)}</div>
      )}
      <div className="tile-footer">
        <span>{name}</span>
        <strong>{status}</strong>
      </div>
    </div>
  );
}

function buildIceServers(): RTCIceServer[] {
  const turnUrl =
    (import.meta.env.VITE_TURN_URL as string | undefined) ??
    `turn:${window.location.hostname}:3478`;
  const username =
    (import.meta.env.VITE_TURN_USERNAME as string | undefined) ?? "demo";
  const credential =
    (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) ?? "demo-password";

  return [{ urls: turnUrl, username, credential }];
}

function replaceVideoTrack(track: MediaStreamTrack, peers: Map<string, PeerRuntime>) {
  for (const runtime of peers.values()) {
    const sender = runtime.pc
      .getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    void sender?.replaceTrack(track);
  }
}

function peerLabel(peer: PeerView) {
  if (peer.connectionState === "connected") {
    return "Receiving";
  }
  if (peer.connectionState === "failed" || peer.iceState === "failed") {
    return "Connection failed";
  }
  if (peer.connectionState === "disconnected") {
    return "Reconnecting";
  }
  return "Connecting";
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "G";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

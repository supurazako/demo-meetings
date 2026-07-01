export type PeerInfo = {
  id: string;
  name: string;
};

export type ServerMessage =
  | { type: "welcome"; id: string; peers: PeerInfo[] }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; id: string }
  | { type: "offer"; fromId: string; description: RTCSessionDescriptionInit }
  | { type: "answer"; fromId: string; description: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; fromId: string; candidate: RTCIceCandidateInit }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; roomId: string; name: string }
  | { type: "offer"; targetId: string; description: RTCSessionDescriptionInit }
  | { type: "answer"; targetId: string; description: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; targetId: string; candidate: RTCIceCandidateInit }
  | { type: "leave" };

export function signalingUrl() {
  const explicit = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (explicit) {
    return explicit;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3001`;
}

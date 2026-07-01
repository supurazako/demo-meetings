export async function getMeetingMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    return createFallbackMedia();
  }
}

function createFallbackMedia() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  let frame = 0;

  const draw = () => {
    frame += 1;
    const hue = (frame / 2) % 360;
    ctx.fillStyle = `hsl(${hue}, 34%, 18%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height * 0.38);
    ctx.fillStyle = "#f7f4ee";
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height * 0.38, 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#243234";
    ctx.beginPath();
    ctx.arc(canvas.width / 2 - 38, canvas.height * 0.36, 10, 0, Math.PI * 2);
    ctx.arc(canvas.width / 2 + 38, canvas.height * 0.36, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#243234";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height * 0.39, 48, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.fillStyle = "rgba(247,244,238,0.88)";
    ctx.font = "600 42px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Camera unavailable", canvas.width / 2, canvas.height * 0.74);
    requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(24);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const destination = audio.createMediaStreamDestination();
    oscillator.frequency.value = 0;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    for (const track of destination.stream.getAudioTracks()) {
      stream.addTrack(track);
    }
  }

  return stream;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

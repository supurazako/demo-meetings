import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = hostsFromEnv(env.VITE_ALLOWED_HOSTS ?? env.MEETING_HOSTNAME);

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts,
    },
  };
});

function hostsFromEnv(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean)
    : [];
}

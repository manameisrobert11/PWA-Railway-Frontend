
import { io } from "socket.io-client";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  "https://pwa-railway-backend-4.onrender.com";

console.log("[SOCKET URL]", SOCKET_URL);

export const socket = io(SOCKET_URL, {
  path: "/socket.io",
  transports: ["polling", "websocket"],
  upgrade: true,
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: 10,
  timeout: 20000,
});

socket.on("connect", () => {
  console.log("✅ Socket.IO connected:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("❌ Socket.IO error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Socket.IO disconnected:", reason);
});

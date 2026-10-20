
 // Frontend/src/socket.js
import { io } from "socket.io-client";

// New Render backend URL
const URL =
  import.meta.env.VITE_SOCKET_URL ||
  "https://pwa-railway-backend-4.onrender.com";

console.log("[SOCKET URL]", URL);

// Socket.IO connection
export const socket = io(URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true,
});

// Connection status
socket.on("connect", () => {
  console.log("✅ Socket.IO connected:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("⚠️ Socket.IO disconnected:", reason);
});

socket.on("connect_error", (error) => {
  console.error("❌ Socket.IO connection error:", error.message);
});

// Frontend/src/socket.js
import { io } from "socket.io-client";

// Hardcode as fallback so builds work even if env var is missing
const URL = import.meta.env.VITE_SOCKET_URL || "https://backend-test-d939.onrender.com";

export const socket = io(URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true,
  // autoConnect: true, // default
});

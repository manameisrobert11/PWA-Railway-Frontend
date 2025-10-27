// src/lib/socket.js
import { io } from "socket.io-client";

// Use .env in dev/prod, hard-code as fallback
const WS_URL = import.meta.env.VITE_WS_URL || "https://backend-test-d939.onrender.com";

export const socket = io(WS_URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true,
});

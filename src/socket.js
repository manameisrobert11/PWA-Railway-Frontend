// Frontend/src/socket.js
import { io } from "socket.io-client";
const URL =
  import.meta.env.VITE_SOCKET_URL ||
  "https://rail-backend-v27f.onrender.com"; // updated fallback
console.log("[SOCKET URL]", URL);
export const socket = io(URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true,
});

// Frontend/src/socket.js
import { io } from "socket.io-client";

const URL =
  import.meta.env.VITE_SOCKET_URL ||
  "https://backend-test-d939.onrender.com"; // fallback

console.log("[SOCKET URL]", URL); // keep this for sanity

export const socket = io(URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true,
});

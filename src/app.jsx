// frontend.js
// All API calls point to Render backend
import { io } from "socket.io-client";

const BACKEND_URL = "https://backend-test-5-1n52.onrender.com"; // Render backend

/* ================= SOCKET ================= */

async function waitForBackend(timeout = 30000, interval = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`);
      if (res.ok) return true;
    } catch (_) {
      // ignore
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error("Backend did not become ready in time");
}

export async function createSocket() {
  await waitForBackend();
  const socket = io(BACKEND_URL, {
    transports: ["websocket"],
    autoConnect: true,
  });

  socket.on("connect", () => console.log("✅ Socket connected:", socket.id));
  socket.on("connect_error", (err) => console.error("❌ Socket connection error:", err));
  socket.on("disconnect", () => console.log("⚠️ Socket disconnected"));

  socket.on("new-scan", (data) => { /* handle MAIN scan */ });
  socket.on("new-scan-alt", (data) => { /* handle ALT scan */ });
  socket.on("deleted-scan", (id) => { /* handle MAIN delete */ });
  socket.on("deleted-scan-alt", (id) => { /* handle ALT delete */ });
  socket.on("cleared-scans", () => { /* handle MAIN clear */ });
  socket.on("cleared-scans-alt", () => { /* handle ALT clear */ });

  return socket;
}

/* ================= API CALLS ================= */

export async function fetchStaged(mode = "main", limit = 200) {
  const path = mode === "alt" ? "/api/staged-alt" : "/api/staged";
  const res = await fetch(`${BACKEND_URL}${path}?limit=${limit}`);
  return res.json();
}

export async function fetchStagedCount(mode = "main") {
  const path = mode === "alt" ? "/api/staged-alt/count" : "/api/staged/count";
  const res = await fetch(`${BACKEND_URL}${path}`);
  const json = await res.json();
  return json.count;
}

export async function checkExists(serial, mode = "main") {
  const path = mode === "alt" ? `/api/exists-alt/${serial}` : `/api/exists/${serial}`;
  const res = await fetch(`${BACKEND_URL}${path}`);
  const json = await res.json();
  return json.exists;
}

export async function postScan(scanData, mode = "main") {
  const path = mode === "alt" ? "/api/scan-alt" : "/api/scan";
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scanData),
  });
  return res.json();
}

export async function bulkScans(scans, mode = "main") {
  const path = mode === "alt" ? "/api/scans-alt/bulk" : "/api/scans/bulk";
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scans),
  });
  return res.json();
}

export async function deleteScan(id, mode = "main") {
  const path = mode === "alt" ? `/api/staged-alt/${id}` : `/api/staged/${id}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { method: "DELETE" });
  return res.json();
}

export async function clearScans(mode = "main") {
  const path = mode === "alt" ? "/api/staged-alt/clear" : "/api/staged/clear";
  const res = await fetch(`${BACKEND_URL}${path}`, { method: "POST" });
  return res.json();
}

export async function exportToExcel(mode = "main") {
  const path = mode === "alt" ? "/api/export-alt-to-excel" : "/api/export-to-excel";
  const res = await fetch(`${BACKEND_URL}${path}`, { method: "POST" });
  return res.json();
}

export async function exportXlsxImages(mode = "main") {
  const path = mode === "alt" ? "/api/export-alt-xlsx-images" : "/api/export-xlsx-images";
  const res = await fetch(`${BACKEND_URL}${path}`, { method: "POST" });
  return res.json();
}

/* ================= INIT ================= */

let socket;
(async () => {
  try {
    socket = await createSocket();
    console.log("✅ Socket is ready");
  } catch (err) {
    console.error("❌ Failed to connect socket:", err);
  }
})();

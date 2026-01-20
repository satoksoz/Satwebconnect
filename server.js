import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({ storage: multer.memoryStorage() });
const devices = new Map();

/* -------------------- STATIC DASHBOARD -------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* -------------------- WS HANDLER -------------------- */
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const deviceId = url.searchParams.get("deviceId");

  if (!deviceId) {
    ws.close();
    return;
  }

  devices.set(deviceId, ws);
  console.log("🟢 ESP32 bağlandı:", deviceId);

  ws.on("message", msg => {
    console.log("📨", deviceId, msg.toString());
  });

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("🔴 ESP32 ayrıldı:", deviceId);
  });
});

/* -------------------- OTA ROUTE -------------------- */
app.post("/ota/:deviceId", upload.single("firmware"), (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("ESP32 offline");

  ws.send(JSON.stringify({
    type: "OTA_BEGIN",
    size: req.file.size
  }));

  ws.send(req.file.buffer);
  ws.send(JSON.stringify({ type: "OTA_END" }));

  res.send("OTA gönderildi");
});

/* -------------------- START SERVER -------------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server çalışıyor PORT:", PORT);
});

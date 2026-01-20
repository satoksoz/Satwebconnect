// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// === ESP32 bağlantıları ===
const devices = new Map(); // deviceId -> ws

// === Static dashboard ===
app.use(express.static("public"));
app.use(express.json());

// === Dashboard API ===
app.get("/api/devices", (req, res) => {
  res.json([...devices.keys()]);
});

// === Reverse HTML Proxy ===
app.get("/proxy/:deviceId/*", (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("Device offline");

  const path = "/" + req.params[0];
  ws.send(JSON.stringify({ type: "HTTP_GET", path }));

  ws.once("message", msg => {
    res.send(msg.toString());
  });
});

// === OTA Upload ===
const upload = multer({ dest: "tmp/" });

app.post("/ota/:deviceId", upload.single("firmware"), (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("Device offline");

  const file = fs.readFileSync(req.file.path);

  ws.send(JSON.stringify({
    type: "OTA_BEGIN",
    size: file.length
  }));

  const CHUNK = 1024;
  let sent = 0;

  while (sent < file.length) {
    ws.send(file.slice(sent, sent + CHUNK));
    sent += CHUNK;
  }

  ws.send(JSON.stringify({ type: "OTA_END" }));
  fs.unlinkSync(req.file.path);

  res.send("OTA started");
});

// === WebSocket ===
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const deviceId = url.searchParams.get("deviceId");

  if (!deviceId) {
    ws.close();
    return;
  }

  devices.set(deviceId, ws);
  console.log("🟢 Device connected:", deviceId);

  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "OTA_PROGRESS") {
        console.log(`📦 ${deviceId} OTA %${data.percent}`);
      }
    } catch {}
  });

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("🔴 Device disconnected:", deviceId);
  });
});

server.listen(PORT, () =>
  console.log("🚀 Server running on", PORT)
);

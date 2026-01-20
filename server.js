import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- HTTP ---------- */
app.get("/", (req, res) => {
  res.send("SatWebConnect Online");
});

/* ---------- WEBSOCKET ---------- */
const wss = new WebSocketServer({ noServer: true });
const devices = new Map();

wss.on("connection", (ws, req) => {
  const deviceId = req.headers["x-device-id"];
  if (!deviceId) return ws.close();

  devices.set(deviceId, ws);
  console.log("🟢 ESP32 connected:", deviceId);

  ws.on("message", msg => {
    if (msg.toString() === "PING") ws.send("PONG");
  });

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("🔴 ESP32 disconnected:", deviceId);
  });
});

/* ---------- OTA ENDPOINT ---------- */
app.post("/:deviceId/ota", (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("offline");

  const firmware = fs.readFileSync("./firmware.bin");

  ws.send(JSON.stringify({
    type: "OTA_BEGIN",
    size: firmware.length
  }));

  const CHUNK = 1024;
  for (let i = 0; i < firmware.length; i += CHUNK) {
    ws.send(firmware.slice(i, i + CHUNK));
  }

  ws.send(JSON.stringify({ type: "OTA_END" }));
  res.send("OK");
});

/* ---------- SERVER ---------- */
const server = app.listen(PORT, () =>
  console.log("🚀 Server running on", PORT)
);

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  }
});

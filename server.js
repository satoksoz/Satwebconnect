import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import multer from "multer";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer();
const devices = new Map();

// ---------------- WEBSOCKET ----------------
wss.on("connection", (ws, req) => {

  ws.on("message", msg => {
    msg = msg.toString();

    if (msg.startsWith("HELLO:")) {
      const id = msg.replace("HELLO:", "");
      ws.deviceId = id;
      devices.set(id, ws);
      console.log("🟢 Online:", id);
    }

    if (msg.startsWith("OTA_PROGRESS:")) {
      console.log(ws.deviceId, msg);
    }
  });

  ws.on("close", () => {
    if (ws.deviceId) {
      devices.delete(ws.deviceId);
      console.log("🔴 Offline:", ws.deviceId);
    }
  });
});

// ---------------- OTA UPLOAD ----------------
app.post("/ota/:deviceId", upload.single("firmware"), (req, res) => {

  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("offline");

  const fw = req.file.buffer;

  ws.send("OTA_BEGIN:" + fw.length);
  ws.send(fw);
  ws.send("OTA_END");

  res.send("OK");
});

// ---------------- DEVICE LIST ----------------
app.get("/devices", (req, res) => {
  res.json([...devices.keys()]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🚀 Server başladı"));

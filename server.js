import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({ dest: "uploads/" });
const devices = new Map();

app.use(express.static("public"));

/* =========================
   DASHBOARD
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

app.get("/devices", (req, res) => {
  res.json([...devices.keys()]);
});

/* =========================
   OTA UPLOAD
========================= */
app.post("/ota/:id", upload.single("firmware"), (req, res) => {
  const ws = devices.get(req.params.id);
  if (!ws) return res.status(404).send("offline");

  const file = fs.readFileSync(req.file.path);

  ws.send(JSON.stringify({
    type: "OTA_BEGIN",
    size: file.length
  }));

  const CHUNK = 1024;
  for (let i = 0; i < file.length; i += CHUNK) {
    ws.send(file.slice(i, i + CHUNK));
  }

  ws.send(JSON.stringify({ type: "OTA_END" }));
  fs.unlinkSync(req.file.path);

  res.send("OTA SENT");
});

/* =========================
   HTML STREAM REQUEST
========================= */
app.get("/device/:id", (req, res) => {
  const ws = devices.get(req.params.id);
  if (!ws) return res.send("Cihaz offline");

  ws.send(JSON.stringify({ type: "HTML_REQUEST" }));

  res.send(`
    <iframe src="/stream/${req.params.id}"
      style="width:100%;height:100vh;border:none"></iframe>
  `);
});

/* =========================
   STREAM HTML
========================= */
app.get("/stream/:id", (req, res) => {
  const ws = devices.get(req.params.id);
  if (!ws) return res.end("offline");

  ws.htmlClient = res;
  req.on("close", () => ws.htmlClient = null);
});

/* =========================
   WEBSOCKET
========================= */
wss.on("connection", (ws, req) => {
  const params = new URLSearchParams(req.url.replace("/?", ""));
  const id = params.get("deviceId");

  if (!id) return ws.close();

  devices.set(id, ws);
  console.log("🟢 ESP32 bağlı:", id);

  ws.on("message", data => {
    if (Buffer.isBuffer(data)) {
      if (ws.htmlClient) ws.htmlClient.write(data);
      return;
    }

    const msg = JSON.parse(data.toString());

    if (msg.type === "HTML_END" && ws.htmlClient) {
      ws.htmlClient.end();
      ws.htmlClient = null;
    }
  });

  ws.on("close", () => {
    devices.delete(id);
    console.log("🔴 ESP32 koptu:", id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server hazır");
});

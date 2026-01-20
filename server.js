const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Cihaz listesi: deviceId => ws
const devices = new Map();

// OTA yükleme için multer
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// Statik dosyalar
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use(express.json());

// WebSocket upgrade
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const deviceId = url.searchParams.get("deviceId");
  if (!deviceId) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.deviceId = deviceId;
    devices.set(deviceId, ws);
    ws.send(JSON.stringify({ type: "CONNECTED", deviceId }));
    
    ws.on("message", (msg) => {
      console.log(`📨 CMD from ${deviceId}: ${msg}`);
    });

    ws.on("close", () => {
      devices.delete(deviceId);
      console.log(`🔴 ${deviceId} disconnected`);
    });
  });
});

// OTA yükleme endpoint
app.post("/ota/:deviceId", upload.single("binfile"), (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("Cihaz offline");

  const filePath = req.file.path;
  const size = fs.statSync(filePath).size;

  ws.send(JSON.stringify({ type: "OTA_BEGIN", size }));

  // Dosyayı parça parça gönder
  const chunkSize = 1024;
  const readStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });

  readStream.on("data", (chunk) => {
    ws.send(JSON.stringify({ type: "OTA_DATA", chunk: chunk.toString("base64") }));
  });

  readStream.on("end", () => {
    ws.send(JSON.stringify({ type: "OTA_END" }));
    res.send("OTA gönderildi");
    fs.unlinkSync(filePath); // temp dosya sil
  });
});

// Başlangıç
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`));

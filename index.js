const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// =============================
// EXPRESS & SERVER
// =============================
const app = express();
const server = http.createServer(app);

// =============================
// WEBSOCKET SERVER
// =============================
const wss = new WebSocket.Server({ server });

// =============================
// CİHAZ HAVUZU
// =============================
const devices = new Map(); // Sat_xxxxx -> ws

// =============================
// ESP32 BAĞLANTI
// =============================
wss.on("connection", (ws, req) => {
  const deviceId = req.headers["x-device-id"];

  if (!deviceId) {
    ws.close();
    return;
  }

  console.log("ESP32 connected:", deviceId);
  devices.set(deviceId, ws);

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("ESP32 disconnected:", deviceId);
  });

  ws.on("error", () => {
    devices.delete(deviceId);
  });
});

// =============================
// DASHBOARD
// =============================
app.get("/", (req, res) => {
  const list = [...devices.keys()]
    .map(id => `<li><a href="/${id}/index.html">${id}</a></li>`)
    .join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sat Web Connect</title>
</head>
<body>
  <h1>Online ESP32 Cihazlar</h1>
  <ul>
    ${list || "<li>Online cihaz yok</li>"}
  </ul>
</body>
</html>
  `);
});

// =============================
// HTML TUNNEL
// =============================
app.get("/:deviceId/:page", (req, res) => {
  const deviceId = req.params.deviceId;
  const page = req.params.page;

  const ws = devices.get(deviceId);

  if (!ws) {
    res.send("Cihaz çevrimdışı");
    return;
  }

  // ESP32'ye istek gönder
  ws.send(`GET /${page}`);

  // ESP32 cevabını al
  ws.once("message", data => {
    res.send(data.toString());
  });

  // Timeout (ESP32 cevap vermezse)
  setTimeout(() => {
    if (!res.headersSent) {
      res.send("Zaman aşımı");
    }
  }, 5000);
});

// =============================
// SERVER START
// =============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

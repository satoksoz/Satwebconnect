import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

/*
  devices = Map {
    "Sat_51218" => WebSocket
  }
*/
const devices = new Map();

/* ------------------------------
   WebSocket – ESP32 bağlantısı
--------------------------------*/
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const deviceId = url.searchParams.get("deviceId");

  if (!deviceId) {
    ws.close();
    return;
  }

  devices.set(deviceId, ws);
  console.log("ONLINE:", deviceId);

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("OFFLINE:", deviceId);
  });
});

/* ------------------------------
   Dashboard – Online cihazlar
--------------------------------*/
app.get("/", (req, res) => {
  let html = "<h2>Online ESP32 Cihazlar</h2><ul>";
  for (const id of devices.keys()) {
    html += `<li><a href="/${id}/index.html">${id}</a></li>`;
  }
  html += "</ul>";
  res.send(html);
});

/* ------------------------------
   HTML TUNNEL (çoklu sayfa)
--------------------------------*/
app.get("/:deviceId/:page", (req, res) => {
  const { deviceId, page } = req.params;
  const ws = devices.get(deviceId);

  if (!ws) {
    return res.status(404).send("Cihaz offline");
  }

  const timeout = setTimeout(() => {
    res.status(504).send("ESP32 cevap vermedi");
  }, 5000);

  ws.once("message", msg => {
    clearTimeout(timeout);
    res.send(msg.toString());
  });

  ws.send(`GET_PAGE:${page}`);
});

/* ------------------------------
   OTA – HTML üzerinden
--------------------------------*/
app.post("/:deviceId/ota.html", (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("offline");

  ws.send("OTA_BEGIN");

  req.on("data", chunk => {
    ws.send(chunk);
  });

  req.on("end", () => {
    ws.send("OTA_END");
    res.send("OK");
  });
});

/* ------------------------------ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

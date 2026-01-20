import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const devices = new Map();

app.use(express.raw({ type: "*/*", limit: "50mb" }));

// ===== WS CONNECTION =====
wss.on("connection", (ws, req) => {
  const deviceId = req.url.replace("/ws/", "");
  devices.set(deviceId, ws);

  ws.on("close", () => {
    devices.delete(deviceId);
  });
});

// ===== DASHBOARD =====
app.get("/", (req, res) => {
  let list = "";
  for (const id of devices.keys()) {
    list += `<li><a href="/${id}/index.html">${id}</a></li>`;
  }

  res.send(`
    <h2>Online ESP32 Cihazlar</h2>
    <ul>${list}</ul>
  `);
});

// ===== HTML ROUTER =====
app.get("/:deviceId/:page", (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.send("Offline");

  ws.send(`GET:/${req.params.page}`);

  ws.once("message", msg => {
    res.send(msg.toString());
  });
});

// ===== OTA =====
app.post("/:deviceId/ota.html", (req, res) => {

  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("offline");

  const size = req.headers["content-length"];
  ws.send(`OTA_BEGIN:${size}`);

  req.on("data", chunk => {
    ws.send(chunk);
  });

  req.on("end", () => {
    ws.send("OTA_END");
    res.send("OK");
  });
});

server.listen(process.env.PORT || 3000);

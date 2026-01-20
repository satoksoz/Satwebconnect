import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import multer from "multer";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer();
const PORT = process.env.PORT || 3000;

/* -----------------------------
   ESP32 Cihaz Haritası
--------------------------------*/
const devices = new Map();

/* -----------------------------
   ANA DASHBOARD
--------------------------------*/
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>SatWebConnect</title>
</head>
<body>
  <h2>🌍 SatWebConnect Dashboard</h2>
  <p>Online ESP32 Cihazlar:</p>
  <ul id="list"></ul>

<script>
fetch("/devices")
  .then(r => r.json())
  .then(list => {
    const ul = document.getElementById("list");
    list.forEach(id => {
      const li = document.createElement("li");
      li.innerHTML =
        id +
        ' <a href="/proxy/' + id + '/">[HTML]</a>' +
        ' <a href="/ota/' + id + '">[OTA]</a>';
      ul.appendChild(li);
    });
  });
</script>
</body>
</html>
`);
});

/* -----------------------------
   ONLINE CİHAZ LİSTESİ
--------------------------------*/
app.get("/devices", (req, res) => {
  res.json([...devices.keys()]);
});

/* -----------------------------
   HTML TUNNEL (ESP32 → Browser)
--------------------------------*/
app.get("/proxy/:deviceId/*", (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("Device offline");

  const path = "/" + (req.params[0] || "");

  ws.send(JSON.stringify({
    type: "HTTP_REQUEST",
    path
  }));

  ws.once("message", msg => {
    res.send(msg.toString());
  });
});

/* -----------------------------
   OTA SAYFASI
--------------------------------*/
app.get("/ota/:deviceId", (req, res) => {
  res.send(`
<h3>OTA Update - ${req.params.deviceId}</h3>
<form method="post" enctype="multipart/form-data">
  <input type="file" name="firmware" />
  <button>Yükle</button>
</form>
<progress id="p" value="0" max="100"></progress>
<script>
const es = new EventSource("/ota-progress/${req.params.deviceId}");
es.onmessage = e => {
  document.getElementById("p").value = e.data;
};
</script>
`);
});

/* -----------------------------
   OTA UPLOAD
--------------------------------*/
app.post("/ota/:deviceId", upload.single("firmware"), (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if (!ws) return res.status(404).send("offline");

  ws.send(JSON.stringify({ type: "OTA_BEGIN", size: req.file.buffer.length }));
  ws.send(req.file.buffer);
  ws.send(JSON.stringify({ type: "OTA_END" }));

  res.send("OTA gönderildi");
});

/* -----------------------------
   WEBSOCKET
--------------------------------*/
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const deviceId = url.searchParams.get("deviceId");

  if (!deviceId) {
    ws.close();
    return;
  }

  devices.set(deviceId, ws);
  console.log("🟢 ESP32 bağlandı:", deviceId);

  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "OTA_PROGRESS") {
        // ileride dashboard'a bağlanabilir
      }
    } catch {
      // HTML response olabilir
    }
  });

  ws.on("close", () => {
    devices.delete(deviceId);
    console.log("🔴 ESP32 ayrıldı:", deviceId);
  });
});

/* -----------------------------
   SERVER START
--------------------------------*/
server.listen(PORT, () => {
  console.log("🚀 SatWebConnect çalışıyor:", PORT);
});

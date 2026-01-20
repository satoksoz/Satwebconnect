import express from "express";
import multer from "multer";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post("/ota/:deviceId", upload.single("firmware"), (req, res) => {

  if (!req.file) {
    return res.status(400).send("DOSYA GELMEDİ");
  }

  const ws = devices.get(req.params.deviceId);
  if (!ws) {
    return res.status(404).send("ESP32 OFFLINE");
  }

  ws.send(JSON.stringify({
    type: "OTA_BEGIN",
    size: req.file.size
  }));

  ws.send(req.file.buffer);

  ws.send(JSON.stringify({ type: "OTA_END" }));

  res.send("OTA gönderildi");
});

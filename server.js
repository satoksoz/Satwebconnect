import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';

const __dirname = path.resolve();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer();
const devices = new Map(); // deviceId -> ws

// Static dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket bağlantısı
wss.on('connection', (ws, req) => {
  let deviceId = null;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'REGISTER') {
        deviceId = data.deviceId;
        devices.set(deviceId, ws);
        console.log(`📡 ESP32 Online: ${deviceId}`);
        ws.send(JSON.stringify({ type: 'REGISTERED', deviceId }));
      }
      if (data.type === 'PONG') {
        // Ping cevabı
      }
    } catch(e) {
      console.log('Mesaj:', msg.toString());
    }
  });

  ws.on('close', () => {
    if(deviceId) {
      devices.delete(deviceId);
      console.log(`🔴 ESP32 Offline: ${deviceId}`);
    }
  });
});

// OTA Route
app.post('/ota/:deviceId', upload.single('file'), async (req, res) => {
  const deviceId = req.params.deviceId;
  const ws = devices.get(deviceId);

  if(!ws || ws.readyState !== ws.OPEN){
    return res.status(404).send("ESP32 offline");
  }

  console.log(`OTA Başlıyor: ${deviceId}, boyut: ${req.file.size}`);
  ws.send(JSON.stringify({ type: "OTA_BEGIN", size: req.file.size }));

  const CHUNK_SIZE = 4096;
  const data = req.file.buffer;

  for(let i=0; i<data.length; i+=CHUNK_SIZE){
    const end = Math.min(i+CHUNK_SIZE, data.length);
    ws.send(data.slice(i, end));
  }

  ws.send(JSON.stringify({ type: "OTA_END" }));
  res.send("OTA gönderildi");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server çalışıyor: http://localhost:${PORT}`));

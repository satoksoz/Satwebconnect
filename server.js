import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const devices = new Map(); // deviceId => ws
app.use(express.json());
app.use(express.static('public')); // dashboard html

// WebSocket bağlantısı
wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/ws?', ''));
  const deviceId = urlParams.get('deviceId');
  if(!deviceId) return ws.close();

  devices.set(deviceId, ws);
  console.log("Device connected:", deviceId);

  ws.on('close', () => {
    devices.delete(deviceId);
    console.log("Device disconnected:", deviceId);
  });
});

// OTA dosya yükleme
const upload = multer({ storage: multer.memoryStorage() });
app.post('/:deviceId/ota.html', upload.single('file'), (req, res) => {
  const ws = devices.get(req.params.deviceId);
  if(!ws) return res.status(404).send("offline");

  const fileBuffer = req.file.buffer;
  ws.send(JSON.stringify({ type:"OTA_BEGIN", size: fileBuffer.length }));

  const chunkSize = 1024;
  for(let i=0; i<fileBuffer.length; i+=chunkSize){
    const end = Math.min(i+chunkSize, fileBuffer.length);
    ws.send(fileBuffer.slice(i, end));
  }

  ws.send(JSON.stringify({ type:"OTA_END" }));
  res.send("OTA Başlatıldı");
});

app.get('/', (req,res)=>{
  res.sendFile('index.html', { root: './public' });
});

server.listen(process.env.PORT || 3000, ()=>{
  console.log("Server running...");
});

const express = require('express');
const app = express();

let devices = []; // {id, name, lastSeen, online}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Ana sayfa
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>ESP32 Dashboard</title></head>
        <body style="font-family:Arial; padding:20px; text-align:center;">
            <h1>ESP32 Dashboard</h1>
            <p>Toplam ${devices.length} cihaz</p>
            <a href="/dashboard" style="padding:10px 20px; background:#007bff; color:white; text-decoration:none; border-radius:5px;">
                Dashboard'a Git
            </a>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// API: Tüm cihazlar
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    devices.forEach(device => {
        device.online = (now - device.lastSeen) < 30000;
    });
    res.json(devices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32' } = req.body;
    
    if (!deviceId) return res.status(400).json({ error: 'Device ID gerekli' });
    
    let device = devices.find(d => d.id === deviceId);
    
    if (device) {
        device.lastSeen = Date.now();
        device.name = deviceName;
    } else {
        device = {
            id: deviceId,
            name: deviceName,
            lastSeen: Date.now(),
            online: true
        };
        devices.push(device);
    }
    
    console.log(`✅ Cihaz: ${deviceId}`);
    res.json({ success: true });
});

// OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) return res.status(404).json({ error: 'Cihaz bulunamadı' });
    
    device.otaActive = true;
    device.otaProgress = 0;
    
    res.json({ success: true, message: 'OTA başlatıldı' });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Sunucu
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server: http://localhost:${PORT}`);
});
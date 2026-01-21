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
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ESP32 Dashboard</title>
            <style>
                body { font-family:Arial; padding:20px; text-align:center; }
                .btn { padding:10px 20px; background:#007bff; color:white; text-decoration:none; border-radius:5px; }
            </style>
        </head>
        <body>
            <h1>ESP32 Dashboard</h1>
            <p>Çevrimiçi: ${onlineCount} / Toplam: ${devices.length} cihaz</p>
            <a href="/dashboard" class="btn">Dashboard'a Git</a>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// API: SADECE ÇEVRİMİÇİ CİHAZLARI GETİR
app.get('/api/devices', (req, res) => {
    console.log('📋 API /api/devices çağrıldı');
    
    const now = Date.now();
    
    // Çevrimiçi cihazları filtrele (son 30 saniye içinde görülenler)
    const onlineDevices = devices
        .filter(device => (now - device.lastSeen) < 30000)
        .map(device => ({
            ...device,
            online: true,
            lastSeenAgo: Math.round((now - device.lastSeen) / 1000)
        }));
    
    console.log(`📊 ${onlineDevices.length} çevrimiçi cihaz döndürülüyor`);
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    console.log('📝 Register request:', req.body);
    
    const { deviceId, deviceName = 'ESP32' } = req.body;
    
    if (!deviceId) {
        console.log('❌ Device ID eksik');
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    let device = devices.find(d => d.id === deviceId);
    
    if (device) {
        // Güncelle
        device.lastSeen = Date.now();
        device.name = deviceName || device.name;
        console.log(`✅ Cihaz güncellendi: ${deviceId}`);
    } else {
        // Yeni cihaz
        device = {
            id: deviceId,
            name: deviceName,
            lastSeen: Date.now(),
            online: true,
            registeredAt: Date.now()
        };
        devices.push(device);
        console.log(`✅ Yeni cihaz eklendi: ${deviceId} - ${deviceName}`);
    }
    
    res.json({ 
        success: true, 
        device: device,
        totalDevices: devices.length 
    });
});

// Sunucu
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server başladı: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});
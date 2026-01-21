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
                body { font-family:Arial; padding:20px; text-align:center; background:#f0f2f5; }
                .btn { padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px; margin:5px; }
                .card { background:white; padding:30px; border-radius:10px; max-width:600px; margin:20px auto; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>📱 ESP32 Dashboard</h1>
                <p>Çevrimiçi: ${onlineCount} / Toplam: ${devices.length} cihaz</p>
                <a href="/dashboard" class="btn">Dashboard'a Git</a>
                <a href="/api/devices" target="_blank" class="btn">API Test</a>
            </div>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// Cihaz detay sayfası - BU EKSİKTİ
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Cihaz Bulunamadı</title></head>
            <body style="font-family:Arial; padding:40px; text-align:center;">
                <h1 style="color:#f44336;">❌ Cihaz Bulunamadı</h1>
                <p><strong>${deviceId}</strong> ID'li cihaz bulunamadı.</p>
                <a href="/dashboard" style="padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px;">
                    Dashboard'a Dön
                </a>
            </body>
            </html>
        `);
    }
    
    const isOnline = (Date.now() - device.lastSeen) < 30000;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${device.name} - Cihaz Detayı</title>
            <style>
                body { font-family: Arial; padding: 20px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                h1 { color: #333; }
                .status { display: inline-block; padding: 5px 15px; border-radius: 20px; color: white; font-weight: bold; }
                .online { background: #4CAF50; }
                .offline { background: #f44336; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
                .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
                .info-item { margin: 10px 0; }
                .label { font-weight: bold; color: #555; }
                .value { color: #333; }
                .btn { display: inline-block; padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${device.name}</h1>
                <span class="status ${isOnline ? 'online' : 'offline'}">
                    ${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                </span>
                
                <div class="info-grid">
                    <div class="info-card">
                        <h3>📊 Cihaz Bilgileri</h3>
                        <div class="info-item"><span class="label">ID:</span> <span class="value">${device.id}</span></div>
                        <div class="info-item"><span class="label">İsim:</span> <span class="value">${device.name}</span></div>
                        <div class="info-item"><span class="label">Son Görülme:</span> <span class="value">${new Date(device.lastSeen).toLocaleString('tr-TR')}</span></div>
                    </div>
                    
                    <div class="info-card">
                        <h3>🌐 Durum</h3>
                        <div class="info-item"><span class="label">Çevrimiçi:</span> <span class="value">${isOnline ? 'Evet' : 'Hayır'}</span></div>
                        <div class="info-item"><span class="label">Kayıt Tarihi:</span> <span class="value">${new Date(device.registeredAt).toLocaleString('tr-TR')}</span></div>
                    </div>
                </div>
                
                <div style="margin-top: 30px;">
                    <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                    <a href="/api/devices" class="btn" target="_blank">📡 API'yi Gör</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// API: SADECE ÇEVRİMİÇİ CİHAZLARI GETİR
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    
    // Çevrimiçi cihazları filtrele
    const onlineDevices = devices
        .filter(device => (now - device.lastSeen) < 30000)
        .map(device => ({
            ...device,
            online: true,
            lastSeenAgo: Math.round((now - device.lastSeen) / 1000)
        }));
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32' } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    let device = devices.find(d => d.id === deviceId);
    
    if (device) {
        // Güncelle
        device.lastSeen = Date.now();
        device.name = deviceName || device.name;
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
    }
    
    console.log(`✅ Cihaz kaydedildi: ${deviceId} - ${device.name}`);
    
    res.json({ 
        success: true, 
        device: device,
        totalDevices: devices.length 
    });
});

// API: OTA başlat - BU EKSİKTİ
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    // OTA durumunu güncelle
    device.otaActive = true;
    device.otaProgress = 0;
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const device = devices.find(d => d.id === req.params.deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    res.json({
        active: device.otaActive || false,
        progress: device.otaProgress || 0
    });
});

// Health check
app.get('/health', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        devices: {
            total: devices.length,
            online: onlineCount
        }
    });
});

// Sunucu
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
========================================
✅ ESP32 Dashboard Server
========================================
🚀 Port: ${PORT}
🏠 Ana Sayfa: http://localhost:${PORT}
📊 Dashboard: http://localhost:${PORT}/dashboard
📡 API: http://localhost:${PORT}/api/devices
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});
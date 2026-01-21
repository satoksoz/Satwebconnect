const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

let devices = []; // {id, name, lastSeen, online, firmwareVersion}
let otaJobs = {}; // {deviceId: {active: true, progress: 0, file: null}}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Uploads klasörü yoksa oluştur
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

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

// Cihaz detay sayfası
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
                        <div class="info-item"><span class="label">Firmware:</span> <span class="value">${device.firmwareVersion || '1.0.0'}</span></div>
                        <div class="info-item"><span class="label">Son Görülme:</span> <span class="value">${new Date(device.lastSeen).toLocaleString('tr-TR')}</span></div>
                    </div>
                    
                    <div class="info-card">
                        <h3>🌐 Durum</h3>
                        <div class="info-item"><span class="label">Çevrimiçi:</span> <span class="value">${isOnline ? 'Evet' : 'Hayır'}</span></div>
                        <div class="info-item"><span class="label">Kayıt Tarihi:</span> <span class="value">${new Date(device.registeredAt).toLocaleString('tr-TR')}</span></div>
                        <div class="info-item"><span class="label">OTA Durumu:</span> <span class="value">${otaJobs[device.id]?.active ? 'Aktif (' + otaJobs[device.id].progress + '%)' : 'Aktif Değil'}</span></div>
                    </div>
                </div>
                
                <div style="margin-top: 30px;">
                    <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                    <a href="/api/devices" class="btn" target="_blank">📡 API'yi Gör</a>
                    <a href="/dashboard" class="btn" style="background:#FF9800;">⚡ OTA Yap</a>
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
            lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
            otaActive: otaJobs[device.id]?.active || false,
            otaProgress: otaJobs[device.id]?.progress || 0
        }));
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32', firmwareVersion = '1.0.0', otaInProgress = false } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    let device = devices.find(d => d.id === deviceId);
    
    if (device) {
        // Güncelle
        device.lastSeen = Date.now();
        device.name = deviceName || device.name;
        device.firmwareVersion = firmwareVersion || device.firmwareVersion;
        
        // Eğer OTA devam ediyorsa, progress'i güncelle
        if (otaInProgress && otaJobs[deviceId]) {
            otaJobs[deviceId].active = true;
        }
    } else {
        // Yeni cihaz
        device = {
            id: deviceId,
            name: deviceName,
            lastSeen: Date.now(),
            online: true,
            firmwareVersion: firmwareVersion,
            registeredAt: Date.now()
        };
        devices.push(device);
    }
    
    console.log(`✅ Cihaz kaydedildi: ${deviceId} - ${device.name} - FW: ${device.firmwareVersion}`);
    
    res.json({ 
        success: true, 
        device: device,
        totalDevices: devices.length 
    });
});

// API: OTA için dosya yükleme
app.post('/api/ota/upload', upload.single('firmware'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Dosya yüklenmedi' });
    }
    
    const { deviceId } = req.body;
    
    if (!deviceId) {
        // Dosyayı sil
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    // Dosya uzantısı kontrolü
    if (!req.file.originalname.toLowerCase().endsWith('.bin')) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Sadece .bin uzantılı dosyalar yüklenebilir' });
    }
    
    // OTA job oluştur
    otaJobs[deviceId] = {
        active: false,
        progress: 0,
        file: {
            path: req.file.path,
            name: req.file.originalname,
            size: req.file.size,
            uploadedAt: Date.now()
        },
        chunks: []
    };
    
    console.log(`📁 OTA dosyası yüklendi: ${req.file.originalname} (${req.file.size} bytes) - ${deviceId}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId
    });
});

// API: OTA firmware indirme (ESP32 için)
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    
    if (!otaJob || !otaJob.file) {
        return res.status(404).json({ error: 'Firmware dosyası bulunamadı' });
    }
    
    const filePath = otaJob.file.path;
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
    
    // Dosyayı gönder
    res.download(filePath, otaJob.file.name, (err) => {
        if (err) {
            console.error('Firmware indirme hatası:', err);
        } else {
            console.log(`📥 Firmware indirildi: ${deviceId} - ${otaJob.file.name}`);
        }
    });
});

// API: OTA ilerlemesini güncelle
app.post('/api/ota/progress', (req, res) => {
    const { deviceId, progress, status } = req.body;
    
    if (!deviceId || progress === undefined) {
        return res.status(400).json({ error: 'Device ID ve progress gerekli' });
    }
    
    const otaJob = otaJobs[deviceId];
    
    if (otaJob) {
        otaJob.progress = progress;
        otaJob.active = status !== 'completed';
        
        if (status === 'completed') {
            otaJob.completedAt = Date.now();
            console.log(`✅ OTA tamamlandı: ${deviceId} - %${progress}`);
            
            // Dosyayı temizle (isteğe bağlı)
            setTimeout(() => {
                if (otaJob.file && fs.existsSync(otaJob.file.path)) {
                    fs.unlinkSync(otaJob.file.path);
                    console.log(`🗑️ Firmware dosyası silindi: ${deviceId}`);
                }
            }, 60000); // 1 dakika sonra sil
        } else {
            console.log(`📊 OTA progress: ${deviceId} - %${progress}`);
        }
    }
    
    res.json({ success: true });
});

// API: OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const device = devices.find(d => d.id === deviceId);
    const otaJob = otaJobs[deviceId];
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    if (!otaJob || !otaJob.file) {
        return res.status(400).json({ error: 'Önce firmware dosyası yükleyin' });
    }
    
    // OTA'yı aktif et
    otaJob.active = true;
    otaJob.progress = 0;
    otaJob.startedAt = Date.now();
    
    console.log(`🚀 OTA başlatıldı: ${deviceId} - ${otaJob.file.name}`);
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        filename: otaJob.file.name,
        size: otaJob.file.size,
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    
    if (!otaJob) {
        return res.json({
            active: false,
            progress: 0,
            hasFile: false
        });
    }
    
    res.json({
        active: otaJob.active || false,
        progress: otaJob.progress || 0,
        hasFile: !!otaJob.file,
        filename: otaJob.file?.name,
        size: otaJob.file?.size,
        startedAt: otaJob.startedAt,
        completedAt: otaJob.completedAt,
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// API: Tüm OTA job'larını getir
app.get('/api/ota/jobs', (req, res) => {
    const jobs = {};
    
    Object.keys(otaJobs).forEach(deviceId => {
        const job = otaJobs[deviceId];
        jobs[deviceId] = {
            active: job.active,
            progress: job.progress,
            hasFile: !!job.file,
            filename: job.file?.name,
            deviceId: deviceId
        };
    });
    
    res.json(jobs);
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const otaJob = otaJobs[deviceId];
    
    if (otaJob) {
        // Dosyayı sil
        if (otaJob.file && fs.existsSync(otaJob.file.path)) {
            fs.unlinkSync(otaJob.file.path);
        }
        
        // Job'ı sil
        delete otaJobs[deviceId];
        
        console.log(`❌ OTA iptal edildi: ${deviceId}`);
    }
    
    res.json({
        success: true,
        message: 'OTA iptal edildi'
    });
});

// API: Tüm cihazları getir (çevrimiçi + çevrimdışı)
app.get('/api/devices/all', (req, res) => {
    const now = Date.now();
    
    const allDevices = devices.map(device => ({
        ...device,
        online: (now - device.lastSeen) < 30000,
        lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
        otaActive: otaJobs[device.id]?.active || false,
        otaProgress: otaJobs[device.id]?.progress || 0
    }));
    
    res.json(allDevices);
});

// API: Cihaz sil
app.delete('/api/devices/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    
    const index = devices.findIndex(d => d.id === deviceId);
    
    if (index !== -1) {
        devices.splice(index, 1);
        console.log(`🗑️ Cihaz silindi: ${deviceId}`);
        
        // OTA job'ını da temizle
        if (otaJobs[deviceId]) {
            delete otaJobs[deviceId];
        }
        
        res.json({ success: true, message: 'Cihaz silindi' });
    } else {
        res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
});

// Health check
app.get('/health', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
        devices: {
            total: devices.length,
            online: onlineCount
        },
        otaJobs: Object.keys(otaJobs).length,
        uptime: process.uptime()
    });
});

// API: Server bilgileri
app.get('/api/server/info', (req, res) => {
    res.json({
        name: 'ESP32 Dashboard Server',
        version: '1.0.0',
        endpoints: [
            '/api/devices',
            '/api/register',
            '/api/ota/upload',
            '/api/ota/start',
            '/api/ota/status/:deviceId',
            '/api/ota/download/:deviceId',
            '/health'
        ],
        timestamp: Date.now()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now()
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server hatası:', err);
    
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: Date.now()
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
⚡ OTA: http://localhost:${PORT}/api/ota
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Memory storage kullanalım - dosyaları diske değil, memory'de saklayalım
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
});

// Memory'de saklanacak veriler
let devices = [];
let otaJobs = {};
let firmwareFiles = {}; // {deviceId: {buffer, name, size, uploadedAt}}

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
                <a href="/debug" class="btn" style="background:#FF9800;">Debug</a>
            </div>
        </body>
        </html>
    `);
});

// Dashboard - public klasöründeki dashboard.html dosyasını sun
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Cihaz detay sayfası - BU ÖNEMLİ!
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
    const otaJob = otaJobs[deviceId];
    const firmwareFile = firmwareFiles[deviceId];
    
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
                .ota-progress { margin: 10px 0; background: #e0e0e0; border-radius: 10px; height: 10px; overflow: hidden; }
                .ota-progress-fill { height: 100%; background: #FF9800; width: ${otaJob?.progress || 0}%; }
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
                        <div class="info-item"><span class="label">Son Görülme:</span> <span class="value">${new Date(device.lastSeen).toLocaleString()}</span></div>
                    </div>
                    
                    <div class="info-card">
                        <h3>🌐 Durum</h3>
                        <div class="info-item"><span class="label">Çevrimiçi:</span> <span class="value">${isOnline ? 'Evet' : 'Hayır'}</span></div>
                        <div class="info-item"><span class="label">Kayıt Tarihi:</span> <span class="value">${new Date(device.registeredAt).toLocaleString()}</span></div>
                        <div class="info-item"><span class="label">OTA Durumu:</span> <span class="value">${otaJob?.active ? 'Aktif (' + otaJob.progress + '%)' : 'Aktif Değil'}</span></div>
                        <div class="info-item"><span class="label">Firmware Dosyası:</span> <span class="value">${firmwareFile ? firmwareFile.name + ' (' + firmwareFile.size + ' bytes)' : 'Yok'}</span></div>
                    </div>
                </div>
                
                ${otaJob?.active ? `
                <div style="margin: 20px 0;">
                    <h3>⚡ OTA Güncellemesi</h3>
                    <div class="ota-progress">
                        <div class="ota-progress-fill"></div>
                    </div>
                    <p>İlerleme: ${otaJob.progress}%</p>
                </div>
                ` : ''}
                
                <div style="margin-top: 30px;">
                    <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                    <a href="/api/devices" class="btn" target="_blank">📡 API'yi Gör</a>
                    <a href="/debug" class="btn" style="background:#FF9800;">🔧 Debug</a>
                    <a href="/api/ota/download/${deviceId}" class="btn" style="background:#4CAF50;" target="_blank">📥 Firmware İndir</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Debug sayfası
app.get('/debug', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debug - ESP32 Dashboard</title>
            <style>
                body { font-family:Arial; padding:20px; background:#f0f2f5; }
                .card { background:white; padding:20px; border-radius:10px; margin:10px 0; }
                pre { background:#f5f5f5; padding:10px; border-radius:5px; overflow:auto; }
                .btn { padding:10px 15px; background:#2196F3; color:white; text-decoration:none; border-radius:5px; margin:5px; display:inline-block; }
            </style>
        </head>
        <body>
            <h1>🔧 Debug Panel</h1>
            
            <div style="margin-bottom:20px;">
                <a href="/" class="btn">🏠 Ana Sayfa</a>
                <a href="/dashboard" class="btn">📊 Dashboard</a>
                <a href="/api/debug/json" class="btn">📋 JSON Data</a>
            </div>
            
            <div class="card">
                <h3>📊 İstatistikler</h3>
                <p>Toplam Cihaz: ${devices.length}</p>
                <p>Çevrimiçi Cihaz: ${onlineCount}</p>
                <p>OTA Jobs: ${Object.keys(otaJobs).length}</p>
                <p>Firmware Dosyaları: ${Object.keys(firmwareFiles).length}</p>
            </div>
            
            <div class="card">
                <h3>📋 Cihazlar</h3>
                ${devices.length > 0 ? devices.map(d => `
                    <div style="margin:10px 0; padding:10px; border:1px solid #ddd; border-radius:5px;">
                        <strong>${d.name}</strong> (${d.id})<br>
                        Firmware: ${d.firmwareVersion || '1.0.0'}<br>
                        Son Görülme: ${new Date(d.lastSeen).toLocaleString()}<br>
                        <a href="/device/${d.id}" class="btn" style="background:#4CAF50; padding:5px 10px; font-size:12px;">Detay</a>
                        <a href="/api/ota/download/${d.id}" class="btn" style="background:#FF9800; padding:5px 10px; font-size:12px;" target="_blank">Firmware İndir</a>
                    </div>
                `).join('') : '<p>Henüz cihaz yok</p>'}
            </div>
            
            <div class="card">
                <h3>⚡ OTA Jobs</h3>
                <pre>${JSON.stringify(otaJobs, null, 2)}</pre>
            </div>
            
            <div class="card">
                <h3>📁 Firmware Dosyaları (Memory)</h3>
                ${Object.keys(firmwareFiles).length > 0 ? 
                    Object.keys(firmwareFiles).map(id => `
                        <div style="margin:10px 0; padding:10px; border:1px solid #ddd; border-radius:5px;">
                            <strong>${id}</strong><br>
                            Dosya: ${firmwareFiles[id].name}<br>
                            Boyut: ${firmwareFiles[id].size} bytes<br>
                            Yükleme: ${new Date(firmwareFiles[id].uploadedAt).toLocaleString()}
                        </div>
                    `).join('') : '<p>Memory\'de firmware dosyası yok</p>'
                }
            </div>
        </body>
        </html>
    `);
});

// API: Çevrimiçi cihazları getir
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    
    const onlineDevices = devices
        .filter(device => (now - device.lastSeen) < 30000)
        .map(device => ({
            ...device,
            online: true,
            lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
            otaActive: otaJobs[device.id]?.active || false,
            otaProgress: otaJobs[device.id]?.progress || 0,
            hasFirmware: !!firmwareFiles[device.id]
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
    
    console.log(`✅ Cihaz kaydedildi: ${deviceId} - ${device.name}`);
    
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
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    // Dosya uzantısı kontrolü
    if (!req.file.originalname.toLowerCase().endsWith('.bin')) {
        return res.status(400).json({ error: 'Sadece .bin uzantılı dosyalar yüklenebilir' });
    }
    
    // ÖNEMLİ: Eski OTA job'ını temizle
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`♻️ Eski OTA job temizlendi: ${deviceId}`);
    }
    
    // Firmware dosyasını memory'de sakla
    firmwareFiles[deviceId] = {
        buffer: req.file.buffer,
        name: req.file.originalname,
        size: req.file.size,
        uploadedAt: Date.now(),
        mimetype: req.file.mimetype
    };
    
    // OTA job oluştur (aktif DEĞİL)
    otaJobs[deviceId] = {
        active: false, // ÖNEMLİ: Başlangıçta aktif değil
        progress: 0,
        startedAt: null,
        completedAt: null,
        file: {
            name: req.file.originalname,
            size: req.file.size
        }
    };
    
    console.log(`📁 Firmware memory'ye kaydedildi: ${deviceId} - ${req.file.originalname}`);
    console.log(`📁 OTA job oluşturuldu (aktif değil): ${deviceId}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`,
        otaActive: false, // Dashboard'a OTA'nın aktif OLMADIĞINI söyle
        hasFile: true
    });
});

// API: OTA firmware indirme
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📥 Firmware indirme isteği: ${deviceId}`);
    
    if (!firmwareFile) {
        return res.status(404).json({ 
            error: 'Firmware dosyası bulunamadı',
            deviceId: deviceId
        });
    }
    
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${firmwareFile.name}"`);
        res.setHeader('Content-Length', firmwareFile.size);
        
        console.log(`📥 Firmware gönderiliyor: ${deviceId} - ${firmwareFile.name}`);
        
        res.send(firmwareFile.buffer);
        
    } catch (err) {
        console.error(`❌ Firmware indirme hatası: ${err.message}`);
        res.status(500).json({ 
            error: 'Dosya gönderme hatası',
            message: err.message
        });
    }
});

// API: OTA ilerlemesini güncelle
app.post('/api/ota/progress', (req, res) => {
    const { deviceId, progress, status } = req.body;
    
    console.log(`📊 OTA progress güncellemesi: ${deviceId} - %${progress} - ${status}`);
    
    if (!deviceId || progress === undefined) {
        return res.status(400).json({ error: 'Device ID ve progress gerekli' });
    }
    
    if (!otaJobs[deviceId]) {
        otaJobs[deviceId] = {
            active: false,
            progress: 0,
            startedAt: null,
            completedAt: null
        };
    }
    
    otaJobs[deviceId].progress = progress;
    otaJobs[deviceId].active = status !== 'completed' && status !== 'failed';
    
    if (status === 'completed') {
        otaJobs[deviceId].completedAt = Date.now();
        otaJobs[deviceId].active = false;
        console.log(`✅ OTA tamamlandı: ${deviceId}`);
        
        // Firmware dosyasını temizle
        if (firmwareFiles[deviceId]) {
            delete firmwareFiles[deviceId];
            console.log(`🗑️ Firmware dosyası silindi: ${deviceId}`);
        }
    } else if (status === 'failed') {
        otaJobs[deviceId].active = false;
        console.log(`❌ OTA başarısız: ${deviceId}`);
    }
    
    res.json({ 
        success: true,
        deviceId: deviceId,
        progress: progress
    });
});

// API: OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`🚀 OTA başlatma isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const device = devices.find(d => d.id === deviceId);
    const firmwareFile = firmwareFiles[deviceId];
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    if (!firmwareFile) {
        return res.status(400).json({ 
            error: 'Önce firmware dosyası yükleyin',
            deviceId: deviceId
        });
    }
    
    // OTA'yı aktif et
    otaJobs[deviceId] = {
        active: true,
        progress: 0,
        startedAt: Date.now(),
        completedAt: null,
        file: {
            name: firmwareFile.name,
            size: firmwareFile.size
        }
    };
    
    console.log(`🚀 OTA başlatıldı: ${deviceId} - ${firmwareFile.name}`);
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        filename: firmwareFile.name,
        size: firmwareFile.size,
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    const firmwareFile = firmwareFiles[deviceId];
    
    const response = {
        active: otaJob?.active || false,
        progress: otaJob?.progress || 0,
        hasFile: !!firmwareFile,
        filename: firmwareFile?.name,
        size: firmwareFile?.size,
        startedAt: otaJob?.startedAt,
        completedAt: otaJob?.completedAt,
        downloadUrl: `/api/ota/download/${deviceId}`,
        deviceId: deviceId
    };
    
    res.json(response);
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`❌ OTA iptal isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`❌ OTA iptal edildi: ${deviceId}`);
    }
    
    // Firmware dosyasını silmeyelim, tekrar kullanılabilir
    
    res.json({
        success: true,
        message: 'OTA iptal edildi',
        deviceId: deviceId
    });
});

// API: Debug JSON data
app.get('/api/debug/json', (req, res) => {
    res.json({
        devices: devices,
        otaJobs: otaJobs,
        firmwareFiles: Object.keys(firmwareFiles).reduce((acc, key) => {
            acc[key] = {
                name: firmwareFiles[key].name,
                size: firmwareFiles[key].size,
                uploadedAt: firmwareFiles[key].uploadedAt
            };
            return acc;
        }, {}),
        timestamp: Date.now()
    });
});

// API: Reset everything (development only)
app.post('/api/reset', (req, res) => {
    devices = [];
    otaJobs = {};
    firmwareFiles = {};
    
    console.log('🔄 Tüm veriler sıfırlandı');
    
    res.json({
        success: true,
        message: 'Tüm veriler sıfırlandı'
    });
});

// Health check
app.get('/health', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        devices: devices.length,
        online: onlineCount,
        otaJobs: Object.keys(otaJobs).length,
        firmwareFiles: Object.keys(firmwareFiles).length
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now(),
        suggestion: 'Geçerli endpointler: /, /dashboard, /debug, /api/*'
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
🔧 Debug: http://localhost:${PORT}/debug
📡 API: http://localhost:${PORT}/api/devices
⚡ OTA: http://localhost:${PORT}/api/ota
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});
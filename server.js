const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Memory storage kullanalım - dosyaları diske değil, memory'de saklayalım
const storage = multer.memoryStorage(); // BU ÖNEMLİ DEĞİŞİKLİK
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

// Uploads klasörü yoksa oluştur (artık kullanılmayacak ama yine de olsun)
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
                <a href="/api/debug" target="_blank" class="btn" style="background:#FF9800;">Debug</a>
            </div>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
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
            </style>
        </head>
        <body>
            <h1>🔧 Debug Panel</h1>
            
            <div class="card">
                <h3>📊 İstatistikler</h3>
                <p>Toplam Cihaz: ${devices.length}</p>
                <p>Çevrimiçi Cihaz: ${onlineCount}</p>
                <p>OTA Jobs: ${Object.keys(otaJobs).length}</p>
                <p>Firmware Dosyaları: ${Object.keys(firmwareFiles).length}</p>
            </div>
            
            <div class="card">
                <h3>📋 Cihazlar</h3>
                <pre>${JSON.stringify(devices, null, 2)}</pre>
            </div>
            
            <div class="card">
                <h3>⚡ OTA Jobs</h3>
                <pre>${JSON.stringify(otaJobs, null, 2)}</pre>
            </div>
            
            <div class="card">
                <h3>📁 Firmware Dosyaları</h3>
                <p>Memory'deki dosyalar: ${Object.keys(firmwareFiles).join(', ')}</p>
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

// API: OTA için dosya yükleme (MEMORY STORAGE)
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
    
    // Firmware dosyasını memory'de sakla
    firmwareFiles[deviceId] = {
        buffer: req.file.buffer,
        name: req.file.originalname,
        size: req.file.size,
        uploadedAt: Date.now(),
        mimetype: req.file.mimetype
    };
    
    // OTA job oluştur veya güncelle
    if (!otaJobs[deviceId]) {
        otaJobs[deviceId] = {
            active: false,
            progress: 0,
            startedAt: null,
            completedAt: null
        };
    }
    
    otaJobs[deviceId].file = {
        name: req.file.originalname,
        size: req.file.size,
        uploadedAt: Date.now()
    };
    
    console.log(`📁 Firmware memory'ye kaydedildi: ${deviceId} - ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`📁 Memory'deki firmware dosyaları: ${Object.keys(firmwareFiles).length}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`,
        inMemory: true
    });
});

// API: OTA firmware indirme (MEMORY'DEN)
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📥 Firmware indirme isteği: ${deviceId}`);
    console.log(`📥 Memory'de dosya var mı: ${!!firmwareFile}`);
    console.log(`📥 Memory'deki tüm dosyalar: ${Object.keys(firmwareFiles).join(', ')}`);
    
    if (!firmwareFile) {
        return res.status(404).json({ 
            error: 'Firmware dosyası bulunamadı',
            message: 'Önce firmware dosyası yükleyin',
            deviceId: deviceId,
            availableFiles: Object.keys(firmwareFiles)
        });
    }
    
    try {
        // Binary dosya olarak gönder
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${firmwareFile.name}"`);
        res.setHeader('Content-Length', firmwareFile.size);
        
        console.log(`📥 Firmware gönderiliyor: ${deviceId} - ${firmwareFile.name} (${firmwareFile.size} bytes)`);
        
        // Buffer'ı gönder
        res.send(firmwareFile.buffer);
        
        console.log(`✅ Firmware başarıyla gönderildi: ${deviceId}`);
        
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
    otaJobs[deviceId].active = status !== 'completed';
    
    if (status === 'completed') {
        otaJobs[deviceId].completedAt = Date.now();
        console.log(`✅ OTA tamamlandı: ${deviceId} - %${progress}`);
        
        // Firmware dosyasını temizle (isteğe bağlı)
        setTimeout(() => {
            if (firmwareFiles[deviceId]) {
                delete firmwareFiles[deviceId];
                console.log(`🗑️ Firmware dosyası memory'den silindi: ${deviceId}`);
            }
        }, 60000); // 1 dakika sonra sil
    } else if (status === 'failed') {
        otaJobs[deviceId].active = false;
        console.log(`❌ OTA başarısız: ${deviceId} - %${progress}`);
    } else {
        console.log(`📊 OTA progress: ${deviceId} - %${progress}`);
    }
    
    res.json({ 
        success: true,
        message: 'Progress güncellendi',
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
        console.log(`❌ Cihaz bulunamadı: ${deviceId}`);
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    if (!firmwareFile) {
        console.log(`❌ Firmware dosyası bulunamadı: ${deviceId}`);
        console.log(`❌ Memory'deki dosyalar: ${Object.keys(firmwareFiles).join(', ')}`);
        return res.status(400).json({ 
            error: 'Önce firmware dosyası yükleyin',
            hasFirmwareFile: !!firmwareFile,
            availableFiles: Object.keys(firmwareFiles)
        });
    }
    
    // OTA job oluştur veya güncelle
    if (!otaJobs[deviceId]) {
        otaJobs[deviceId] = {
            active: false,
            progress: 0,
            startedAt: null,
            completedAt: null
        };
    }
    
    // OTA'yı aktif et
    otaJobs[deviceId].active = true;
    otaJobs[deviceId].progress = 0;
    otaJobs[deviceId].startedAt = Date.now();
    otaJobs[deviceId].completedAt = null;
    otaJobs[deviceId].file = {
        name: firmwareFile.name,
        size: firmwareFile.size
    };
    
    console.log(`🚀 OTA başlatıldı: ${deviceId} - ${firmwareFile.name}`);
    console.log(`📁 Memory'deki dosya boyutu: ${firmwareFile.size} bytes`);
    console.log(`📁 Download URL: /api/ota/download/${deviceId}`);
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        filename: firmwareFile.name,
        size: firmwareFile.size,
        downloadUrl: `/api/ota/download/${deviceId}`,
        inMemory: true
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📡 OTA status isteği: ${deviceId}`);
    
    const response = {
        active: otaJob?.active || false,
        progress: otaJob?.progress || 0,
        hasFile: !!firmwareFile,
        filename: firmwareFile?.name,
        size: firmwareFile?.size,
        startedAt: otaJob?.startedAt,
        completedAt: otaJob?.completedAt,
        downloadUrl: `/api/ota/download/${deviceId}`,
        deviceId: deviceId,
        inMemory: !!firmwareFile
    };
    
    console.log(`📡 OTA status yanıtı: ${JSON.stringify(response)}`);
    
    res.json(response);
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`❌ OTA iptal isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    // OTA job'ını sıfırla
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`❌ OTA iptal edildi: ${deviceId}`);
    }
    
    // Firmware dosyasını sil (isteğe bağlı)
    if (firmwareFiles[deviceId]) {
        delete firmwareFiles[deviceId];
        console.log(`🗑️ Firmware dosyası memory'den silindi: ${deviceId}`);
    }
    
    res.json({
        success: true,
        message: 'OTA iptal edildi',
        deviceId: deviceId
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
            hasFile: !!firmwareFiles[deviceId],
            filename: firmwareFiles[deviceId]?.name,
            deviceId: deviceId,
            startedAt: job.startedAt,
            completedAt: job.completedAt
        };
    });
    
    res.json({
        jobs: jobs,
        count: Object.keys(jobs).length,
        firmwareFilesCount: Object.keys(firmwareFiles).length
    });
});

// API: Tüm cihazları getir
app.get('/api/devices/all', (req, res) => {
    const now = Date.now();
    
    const allDevices = devices.map(device => ({
        ...device,
        online: (now - device.lastSeen) < 30000,
        lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
        otaActive: otaJobs[device.id]?.active || false,
        otaProgress: otaJobs[device.id]?.progress || 0
    }));
    
    res.json({
        devices: allDevices,
        count: allDevices.length,
        onlineCount: allDevices.filter(d => d.online).length
    });
});

// API: Cihaz sil
app.delete('/api/devices/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    
    console.log(`🗑️ Cihaz silme isteği: ${deviceId}`);
    
    const index = devices.findIndex(d => d.id === deviceId);
    
    if (index !== -1) {
        devices.splice(index, 1);
        console.log(`🗑️ Cihaz silindi: ${deviceId}`);
        
        // OTA job'ını temizle
        if (otaJobs[deviceId]) {
            delete otaJobs[deviceId];
        }
        
        // Firmware dosyasını temizle
        if (firmwareFiles[deviceId]) {
            delete firmwareFiles[deviceId];
        }
        
        res.json({ 
            success: true, 
            message: 'Cihaz silindi',
            deviceId: deviceId
        });
    } else {
        res.status(404).json({ 
            error: 'Cihaz bulunamadı',
            deviceId: deviceId
        });
    }
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
    res.json({
        devicesCount: devices.length,
        otaJobsCount: Object.keys(otaJobs).length,
        firmwareFilesCount: Object.keys(firmwareFiles).length,
        devices: devices.map(d => ({ id: d.id, name: d.name, lastSeen: d.lastSeen })),
        otaJobs: Object.keys(otaJobs),
        firmwareFiles: Object.keys(firmwareFiles),
        timestamp: Date.now()
    });
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
        firmwareFiles: Object.keys(firmwareFiles).length,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 - Bulunamayan endpoint: ${req.method} ${req.path}`);
    
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now()
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Server hatası:', err);
    
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
✅ ESP32 Dashboard Server (MEMORY STORAGE)
========================================
🚀 Port: ${PORT}
🏠 Ana Sayfa: http://localhost:${PORT}
📊 Dashboard: http://localhost:${PORT}/dashboard
🔧 Debug: http://localhost:${PORT}/debug
📡 API: http://localhost:${PORT}/api/devices
⚡ OTA: http://localhost:${PORT}/api/ota
📥 Download: http://localhost:${PORT}/api/ota/download/:deviceId
❤️  Health: http://localhost:${PORT}/health
========================================
NOT: Firmware dosyaları memory'de saklanıyor!
========================================
    `);
});
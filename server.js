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
                <a href="/api/debug/endpoints" target="_blank" class="btn" style="background:#FF9800;">Debug Endpoints</a>
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
                    <a href="/api/ota/download/${deviceId}" class="btn" style="background:#4CAF50;" target="_blank">📥 Firmware İndir</a>
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
        startedAt: null,
        completedAt: null
    };
    
    console.log(`📁 OTA dosyası yüklendi: ${req.file.originalname} (${req.file.size} bytes) - ${deviceId}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// API: OTA firmware indirme (ESP32 için) - BU ÇOK ÖNEMLİ!
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    
    console.log(`📥 Firmware indirme isteği: ${deviceId}`);
    console.log(`📥 OTA job mevcut: ${!!otaJob}`);
    
    if (!otaJob) {
        console.log(`❌ OTA job bulunamadı: ${deviceId}`);
        return res.status(404).json({ 
            error: 'Firmware dosyası bulunamadı',
            message: 'Önce firmware dosyası yükleyin ve OTA başlatın',
            deviceId: deviceId,
            availableJobs: Object.keys(otaJobs)
        });
    }
    
    if (!otaJob.file) {
        console.log(`❌ OTA dosyası bulunamadı: ${deviceId}`);
        return res.status(404).json({ 
            error: 'Firmware dosyası bulunamadı',
            deviceId: deviceId 
        });
    }
    
    const filePath = otaJob.file.path;
    
    console.log(`📥 Dosya yolu: ${filePath}`);
    console.log(`📥 Dosya adı: ${otaJob.file.name}`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`❌ Dosya fiziksel olarak bulunamadı: ${filePath}`);
        return res.status(404).json({ 
            error: 'Dosya bulunamadı',
            path: filePath,
            exists: fs.existsSync(filePath)
        });
    }
    
    try {
        // Content-Type'ı binary olarak ayarla
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${otaJob.file.name}"`);
        res.setHeader('Content-Length', otaJob.file.size);
        
        console.log(`📥 Firmware gönderiliyor: ${deviceId} - ${otaJob.file.name} (${otaJob.file.size} bytes)`);
        
        // Dosyayı stream et
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err) => {
            console.error(`❌ Dosya stream hatası: ${err.message}`);
            res.status(500).json({ error: 'Dosya okuma hatası' });
        });
        
        res.on('finish', () => {
            console.log(`✅ Firmware başarıyla gönderildi: ${deviceId}`);
        });
        
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
                    try {
                        fs.unlinkSync(otaJob.file.path);
                        console.log(`🗑️ Firmware dosyası silindi: ${deviceId}`);
                    } catch (err) {
                        console.error(`🗑️ Dosya silme hatası: ${err.message}`);
                    }
                }
            }, 60000); // 1 dakika sonra sil
        } else if (status === 'failed') {
            otaJob.active = false;
            console.log(`❌ OTA başarısız: ${deviceId} - %${progress}`);
        } else {
            console.log(`📊 OTA progress: ${deviceId} - %${progress}`);
        }
    } else {
        console.log(`⚠️ OTA job bulunamadı: ${deviceId}`);
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
    const otaJob = otaJobs[deviceId];
    
    if (!device) {
        console.log(`❌ Cihaz bulunamadı: ${deviceId}`);
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    if (!otaJob || !otaJob.file) {
        console.log(`❌ Firmware dosyası bulunamadı: ${deviceId}`);
        console.log(`❌ Mevcut OTA job: ${JSON.stringify(otaJob)}`);
        return res.status(400).json({ 
            error: 'Önce firmware dosyası yükleyin',
            hasOTAJob: !!otaJob,
            hasFile: !!(otaJob && otaJob.file)
        });
    }
    
    // OTA'yı aktif et
    otaJob.active = true;
    otaJob.progress = 0;
    otaJob.startedAt = Date.now();
    otaJob.completedAt = null;
    
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
    
    console.log(`📡 OTA status isteği: ${deviceId}`);
    
    if (!otaJob) {
        console.log(`⚠️ OTA job bulunamadı: ${deviceId}`);
        return res.json({
            active: false,
            progress: 0,
            hasFile: false,
            deviceId: deviceId,
            message: 'OTA job bulunamadı'
        });
    }
    
    const response = {
        active: otaJob.active || false,
        progress: otaJob.progress || 0,
        hasFile: !!otaJob.file,
        filename: otaJob.file?.name,
        size: otaJob.file?.size,
        startedAt: otaJob.startedAt,
        completedAt: otaJob.completedAt,
        downloadUrl: `/api/ota/download/${deviceId}`,
        deviceId: deviceId
    };
    
    console.log(`📡 OTA status yanıtı: ${JSON.stringify(response)}`);
    
    res.json(response);
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
            deviceId: deviceId,
            startedAt: job.startedAt,
            completedAt: job.completedAt
        };
    });
    
    res.json({
        jobs: jobs,
        count: Object.keys(jobs).length
    });
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`❌ OTA iptal isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const otaJob = otaJobs[deviceId];
    
    if (otaJob) {
        // Dosyayı sil
        if (otaJob.file && fs.existsSync(otaJob.file.path)) {
            try {
                fs.unlinkSync(otaJob.file.path);
                console.log(`🗑️ OTA dosyası silindi: ${deviceId}`);
            } catch (err) {
                console.error(`🗑️ Dosya silme hatası: ${err.message}`);
            }
        }
        
        // Job'ı sil
        delete otaJobs[deviceId];
        
        console.log(`❌ OTA iptal edildi: ${deviceId}`);
    } else {
        console.log(`⚠️ İptal edilecek OTA job bulunamadı: ${deviceId}`);
    }
    
    res.json({
        success: true,
        message: 'OTA iptal edildi',
        deviceId: deviceId
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
        
        // OTA job'ını da temizle
        if (otaJobs[deviceId]) {
            delete otaJobs[deviceId];
        }
        
        res.json({ 
            success: true, 
            message: 'Cihaz silindi',
            deviceId: deviceId
        });
    } else {
        console.log(`❌ Silinecek cihaz bulunamadı: ${deviceId}`);
        res.status(404).json({ 
            error: 'Cihaz bulunamadı',
            deviceId: deviceId
        });
    }
});

// Debug: Tüm endpoint'leri listele
app.get('/api/debug/endpoints', (req, res) => {
    const endpoints = [];
    
    function getEndpoints(stack, basePath = '') {
        stack.forEach((middleware) => {
            if (middleware.route) {
                // routes registered directly on the app
                const methods = Object.keys(middleware.route.methods);
                endpoints.push({
                    path: basePath + middleware.route.path,
                    methods: methods
                });
            } else if (middleware.name === 'router') {
                // router middleware
                if (middleware.handle && middleware.handle.stack) {
                    getEndpoints(middleware.handle.stack, basePath);
                }
            }
        });
    }
    
    getEndpoints(app._router.stack);
    
    res.json({
        endpoints: endpoints,
        totalEndpoints: endpoints.length,
        otaJobs: Object.keys(otaJobs),
        totalDevices: devices.length,
        serverTime: new Date().toISOString()
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
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
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
            '/api/ota/progress',
            '/health',
            '/api/debug/endpoints'
        ],
        timestamp: Date.now()
    });
});

// API: Test endpoint - Firmware dosyası kontrolü
app.get('/api/test/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    
    if (!otaJob) {
        return res.json({
            success: false,
            message: 'OTA job bulunamadı',
            deviceId: deviceId,
            availableJobs: Object.keys(otaJobs)
        });
    }
    
    res.json({
        success: true,
        deviceId: deviceId,
        otaJob: {
            active: otaJob.active,
            progress: otaJob.progress,
            hasFile: !!otaJob.file,
            filename: otaJob.file?.name,
            size: otaJob.file?.size,
            path: otaJob.file?.path,
            fileExists: otaJob.file ? fs.existsSync(otaJob.file.path) : false
        },
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 - Bulunamayan endpoint: ${req.method} ${req.path}`);
    
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now(),
        suggestion: 'Geçerli endpointler için /api/debug/endpoints adresini ziyaret edin'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Server hatası:', err);
    
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: Date.now(),
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
📥 Download: http://localhost:${PORT}/api/ota/download/:deviceId
🔧 Debug: http://localhost:${PORT}/api/debug/endpoints
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});
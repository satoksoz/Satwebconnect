const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();

// Memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    }
});

// Memory'de saklanacak veriler
let devices = [];
let otaJobs = {};
let firmwareFiles = {};
let deviceStates = {};

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Reverse Proxy için yardımcı fonksiyon
async function proxyRequest(targetUrl, req, res) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(targetUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 80,
            path: parsedUrl.pathname + (parsedUrl.search || ''),
            method: req.method,
            headers: {
                ...req.headers,
                host: parsedUrl.hostname,
                'x-forwarded-for': req.ip,
                'x-forwarded-host': req.get('host')
            }
        };

        const proxyReq = http.request(options, (proxyRes) => {
            // Headers'ı kopyala
            Object.keys(proxyRes.headers).forEach(key => {
                // Bazı headers'ı değiştir
                if (key.toLowerCase() !== 'content-length') {
                    res.setHeader(key, proxyRes.headers[key]);
                }
            });
            
            res.status(proxyRes.statusCode);
            
            // Stream veriyi
            proxyRes.pipe(res);
            
            proxyRes.on('end', () => {
                resolve();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy error:', err);
            reject(err);
        });

        // Request body varsa gönder
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.write(JSON.stringify(req.body));
        }
        
        proxyReq.end();
    });
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
                <a href="/debug" class="btn" style="background:#FF9800;">Debug</a>
            </div>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Reverse Proxy için ESP32 HTML görüntüleme
app.get('/device/:deviceId/html', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).send('Cihaz bulunamadı');
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).send('Cihaz IP adresi bilinmiyor');
    }
    
    try {
        // ESP32'nin ana sayfasını proxy ile getir
        const targetUrl = `http://${deviceIp}/`;
        await proxyRequest(targetUrl, req, res);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('ESP32 bağlantı hatası');
    }
});

// Reverse Proxy için genel endpoint
app.all('/device/:deviceId/proxy/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).json({ 
            error: 'Cihaz IP adresi bilinmiyor',
            deviceId: deviceId
        });
    }
    
    const proxyPath = req.params[0] || '';
    const targetUrl = `http://${deviceIp}/${proxyPath}`;
    
    console.log(`🔗 Proxy: ${deviceId} -> ${targetUrl}`);
    
    try {
        await proxyRequest(targetUrl, req, res);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(502).json({ 
            error: 'ESP32 bağlantı hatası',
            message: error.message
        });
    }
});

// Cihaz detay sayfası
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    const deviceState = deviceStates[deviceId] || { ledState: false, temperature: 25.0, ipAddress: null };
    
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
                .status { padding: 5px 15px; border-radius: 20px; color: white; font-weight: bold; display: inline-block; }
                .online { background: #4CAF50; }
                .offline { background: #f44336; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
                .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
                .btn { padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 5px; display: inline-block; }
                .iframe-container { width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0; }
                iframe { width: 100%; height: 100%; border: none; }
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
                        <p><strong>ID:</strong> ${device.id}</p>
                        <p><strong>İsim:</strong> ${device.name}</p>
                        <p><strong>Firmware:</strong> ${device.firmwareVersion || '1.0.0'}</p>
                        <p><strong>IP:</strong> ${deviceState.ipAddress || 'Bilinmiyor'}</p>
                    </div>
                    
                    <div class="info-card">
                        <h3>🌐 Durum</h3>
                        <p><strong>Sıcaklık:</strong> ${deviceState.temperature.toFixed(1)}°C</p>
                        <p><strong>LED:</strong> ${deviceState.ledState ? '🟢 AÇIK' : '🔴 KAPALI'}</p>
                        <p><strong>Son Görülme:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>
                        <p><strong>OTA:</strong> ${otaJob?.active ? 'Aktif' : 'Aktif Değil'}</p>
                    </div>
                </div>
                
                <div class="iframe-container">
                    <iframe src="/device/${deviceId}/html" title="${device.name} Arayüzü"></iframe>
                </div>
                
                <div style="margin-top: 20px;">
                    <a href="/device/${deviceId}/html" class="btn" target="_blank">🔗 Yeni Sekmede Aç</a>
                    <a href="/device/${deviceId}/proxy/temperature" class="btn" target="_blank">🌡️ Sıcaklık</a>
                    <a href="/device/${deviceId}/proxy/led/toggle" class="btn" target="_blank">💡 LED Kontrol</a>
                    <a href="/dashboard" class="btn">📊 Dashboard</a>
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
                ${devices.length > 0 ? devices.map(d => {
                    const state = deviceStates[d.id] || {};
                    return `
                    <div style="margin:10px 0; padding:10px; border:1px solid #ddd; border-radius:5px;">
                        <strong>${d.name}</strong> (${d.id})<br>
                        IP: ${state.ipAddress || 'Bilinmiyor'}<br>
                        Sıcaklık: ${state.temperature?.toFixed(1) || '25.0'}°C<br>
                        LED: ${state.ledState ? '🟢 AÇIK' : '🔴 KAPALI'}<br>
                        <a href="/device/${d.id}" class="btn" style="background:#4CAF50; padding:5px 10px; font-size:12px;">Detay</a>
                        <a href="/device/${d.id}/html" class="btn" style="background:#2196F3; padding:5px 10px; font-size:12px;" target="_blank">HTML</a>
                    </div>
                `}).join('') : '<p>Henüz cihaz yok</p>'}
            </div>
            
            <div class="card">
                <h3>⚡ OTA Jobs</h3>
                <pre>${JSON.stringify(otaJobs, null, 2)}</pre>
            </div>
        </body>
        </html>
    `);
});

// API: Cihaz durumu
app.get('/api/device/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    const deviceState = deviceStates[deviceId];
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const isOnline = (Date.now() - device.lastSeen) < 30000;
    
    res.json({
        device: device,
        deviceState: deviceState || { ledState: false, temperature: 25.0 },
        online: isOnline,
        lastSeenAgo: Math.round((Date.now() - device.lastSeen) / 1000),
        otaActive: otaJobs[deviceId]?.active || false,
        otaProgress: otaJobs[deviceId]?.progress || 0,
        hasFirmware: !!firmwareFiles[deviceId]
    });
});

// API: Çevrimiçi cihazları getir
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    
    const onlineDevices = devices
        .filter(device => (now - device.lastSeen) < 30000)
        .map(device => {
            const deviceState = deviceStates[device.id] || { ledState: false, temperature: 25.0 };
            
            return {
                ...device,
                online: true,
                lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
                otaActive: otaJobs[device.id]?.active || false,
                otaProgress: otaJobs[device.id]?.progress || 0,
                hasFirmware: !!firmwareFiles[device.id],
                ledState: deviceState.ledState,
                temperature: deviceState.temperature,
                ipAddress: deviceState.ipAddress
            };
        });
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32', firmwareVersion = '1.0.0', 
            otaInProgress = false, temperature = 25.0, ledState = false, 
            ipAddress = null, port = 80 } = req.body;
    
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
    
    // Cihaz durumunu güncelle
    deviceStates[deviceId] = {
        ledState: ledState,
        temperature: temperature,
        ipAddress: ipAddress,
        port: port,
        lastUpdate: Date.now()
    };
    
    console.log(`✅ Cihaz kaydedildi: ${deviceId} - ${device.name} - IP: ${ipAddress}`);
    
    res.json({ 
        success: true, 
        device: device,
        deviceState: deviceStates[deviceId],
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
    
    if (!req.file.originalname.toLowerCase().endsWith('.bin')) {
        return res.status(400).json({ error: 'Sadece .bin uzantılı dosyalar yüklenebilir' });
    }
    
    // Eski OTA job'ını temizle
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
    
    // OTA job oluştur
    otaJobs[deviceId] = {
        active: false,
        progress: 0,
        startedAt: null,
        completedAt: null,
        file: {
            name: req.file.originalname,
            size: req.file.size
        }
    };
    
    console.log(`📁 Firmware memory'ye kaydedildi: ${deviceId} - ${req.file.originalname}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`,
        otaActive: false,
        hasFile: true
    });
});

// API: OTA firmware indirme
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📥 Firmware indirme isteği: ${deviceId}`);
    
    if (!firmwareFile) {
        return res.status(404).json({ error: 'Firmware dosyası bulunamadı' });
    }
    
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${firmwareFile.name}"`);
        res.setHeader('Content-Length', firmwareFile.size);
        
        console.log(`📥 Firmware gönderiliyor: ${deviceId} - ${firmwareFile.name}`);
        
        res.send(firmwareFile.buffer);
        
    } catch (err) {
        console.error(`❌ Firmware indirme hatası: ${err.message}`);
        res.status(500).json({ error: 'Dosya gönderme hatası' });
    }
});

// API: OTA ilerlemesini güncelle
app.post('/api/ota/progress', (req, res) => {
    const { deviceId, progress, status } = req.body;
    
    console.log(`📊 OTA progress: ${deviceId} - %${progress} - ${status}`);
    
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
        return res.status(400).json({ error: 'Önce firmware dosyası yükleyin' });
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
        deviceStates: deviceStates,
        timestamp: Date.now()
    });
});

// API: Reset everything
app.post('/api/reset', (req, res) => {
    devices = [];
    otaJobs = {};
    firmwareFiles = {};
    deviceStates = {};
    
    console.log('🔄 Tüm veriler sıfırlandı');
    
    res.json({
        success: true,
        message: 'Tüm veriler sıfırlandı'
    });
});

// Health check
app.get('/health', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    const deviceStatuses = devices.map(device => {
        const state = deviceStates[device.id] || {};
        return {
            id: device.id,
            name: device.name,
            online: (Date.now() - device.lastSeen) < 30000,
            ledState: state.ledState || false,
            temperature: state.temperature || 25.0,
            ipAddress: state.ipAddress
        };
    });
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        devices: devices.length,
        online: onlineCount,
        otaJobs: Object.keys(otaJobs).length,
        firmwareFiles: Object.keys(firmwareFiles).length,
        deviceStates: Object.keys(deviceStates).length,
        deviceStatuses: deviceStatuses
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
🔗 Reverse Proxy: http://localhost:${PORT}/device/:id/html
⚡ OTA: http://localhost:${PORT}/api/ota
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Veri depolama için Map
const devices = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Dashboard sayfası
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Ana sayfa
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>SAT Device Management</title>
            <style>
                body { font-family: sans-serif; padding: 20px; background: #f0f2f5; }
                .container { max-width: 800px; margin: 0 auto; }
                .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #1a237e; }
                .btn { display: inline-block; padding: 12px 24px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
                .btn:hover { background: #1976D2; }
                .stats { display: flex; gap: 20px; margin: 20px 0; }
                .stat { flex: 1; text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <h1>📡 SAT Device Management System</h1>
                    <p>ESP32-S3 cihazlarınızı yönetin ve OTA güncellemeleri yapın.</p>
                    
                    <div class="stats">
                        <div class="stat">
                            <h3>${devices.size}</h3>
                            <p>Toplam Cihaz</p>
                        </div>
                        <div class="stat">
                            <h3>${Array.from(devices.values()).filter(d => (Date.now() - d.lastSeen) < 30000).length}</h3>
                            <p>Çevrimiçi</p>
                        </div>
                    </div>
                    
                    <a href="/dashboard" class="btn">📊 Dashboard'a Git</a>
                    <a href="/api/devices" class="btn">📋 API'yi Görüntüle</a>
                    <a href="/health" class="btn">❤️ Health Check</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        devices: devices.size,
        onlineDevices: Array.from(devices.values()).filter(d => (Date.now() - d.lastSeen) < 30000).length
    });
});

// API: Tüm cihazları listele (DASHBOARD İÇİN GEREKLİ)
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([deviceId, device]) => ({
        deviceId,
        model: device.model || 'ESP32-S3',
        ip: device.ip || 'N/A',
        mac: device.mac || 'unknown',
        location: device.location || 'Unknown',
        purpose: device.purpose || 'General',
        lastSeen: device.lastSeen || Date.now(),
        online: (Date.now() - device.lastSeen) < 30000,
        firmware: device.firmware || 'unknown',
        features: device.features || 'unknown',
        heap: device.heap || 0,
        flash: device.flash || 0,
        chipId: device.chipId || 'unknown',
        chipRevision: device.chipRevision || 0,
        sdkVersion: device.sdkVersion || 'unknown',
        otaActive: device.otaActive || false,
        otaProgress: device.otaProgress || 0,
        rssi: device.rssi || null,
        customName: device.customName || '',
        deviceIndex: device.deviceIndex || 0,
        registeredAt: device.registeredAt || Date.now(),
        sessionId: device.sessionId || 'none'
    }));
    
    res.json(deviceList);
});

// API: Tek cihaz detayı
app.get('/api/device/:deviceId', (req, res) => {
    const device = devices.get(req.params.deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
        deviceId: req.params.deviceId,
        ...device,
        online: (Date.now() - device.lastSeen) < 30000
    });
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    console.log('\n=== REGISTER REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { 
        deviceId, 
        model, 
        ip, 
        mac, 
        location, 
        purpose, 
        firmware, 
        features, 
        heap, 
        flash,
        chipId,
        chipRevision,
        sdkVersion,
        rssi,
        customName,
        deviceIndex
    } = req.body;
    
    if (!deviceId) {
        console.log('ERROR: No deviceId provided');
        return res.status(400).json({ 
            error: 'Invalid request',
            message: 'deviceId is required',
            received: req.body
        });
    }
    
    // Device ID format kontrolü
    if (!deviceId.startsWith('Sat_')) {
        console.log('WARN: Device ID does not start with Sat_:', deviceId);
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    // Mevcut device varsa güncelle, yoksa yeni oluştur
    const existingDevice = devices.get(deviceId);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        model: model || 'ESP32-S3',
        ip: ip || req.ip,
        mac: mac || 'unknown',
        location: location || 'Unknown',
        purpose: purpose || 'General',
        lastSeen: Date.now(),
        queue: existingDevice ? existingDevice.queue : [],
        registeredAt: existingDevice ? existingDevice.registeredAt : Date.now(),
        firmware: firmware || 'unknown',
        features: features || 'unknown',
        heap: heap || 0,
        flash: flash || 0,
        chipId: chipId || 'unknown',
        chipRevision: chipRevision || 0,
        sdkVersion: sdkVersion || 'unknown',
        otaActive: false,
        otaProgress: 0,
        rssi: rssi || null,
        customName: customName || '',
        deviceIndex: deviceIndex || 0
    });
    
    console.log(`✅ Registered/Updated device: ${deviceId}`);
    console.log(`   Model: ${model || 'ESP32-S3'}`);
    console.log(`   Location: ${location || 'Unknown'}`);
    console.log(`   Chip ID: ${chipId || 'unknown'}`);
    console.log(`   Session: ${sessionId}`);
    console.log(`   Total devices now: ${devices.size}`);
    
    // Tüm cihazları listele
    console.log('📋 All registered devices:');
    devices.forEach((device, id) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        console.log(`   ${id} - ${isOnline ? '🟢' : '🔴'} ${device.location} (Chip: ${device.chipId})`);
    });
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now(),
        serverUrl: req.protocol + '://' + req.get('host'),
        message: 'Device registered successfully',
        totalDevices: devices.size,
        commands: existingDevice ? (existingDevice.queue || []) : []
    });
});

// API: Poll endpoint (ESP32'den komut beklemek için)
app.post('/api/poll', (req, res) => {
    const { deviceId, session } = req.body;
    
    if (!deviceId || !session) {
        return res.status(400).json({ error: 'deviceId and session required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    if (device.sessionId !== session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    // Cihazın son görülme zamanını güncelle
    device.lastSeen = Date.now();
    devices.set(deviceId, device);
    
    // Kuyruktaki komutları kontrol et
    if (device.queue && device.queue.length > 0) {
        const command = device.queue.shift();
        devices.set(deviceId, device);
        
        console.log(`📨 Sending command to ${deviceId}: ${command.type}`);
        return res.json(command);
    }
    
    // OTA aktifse OTA komutu gönder
    if (device.otaActive && device.otaRequestId) {
        return res.json({
            type: 'ota_continue',
            requestId: device.otaRequestId
        });
    }
    
    // Hiçbir komut yoksa 204 No Content
    res.status(204).send();
});

// API: Response endpoint (ESP32'den gelen yanıtlar için)
app.post('/api/response', (req, res) => {
    const { requestId, contentType, body } = req.body;
    
    console.log(`📥 Response received for request ${requestId}`);
    console.log(`Content-Type: ${contentType}`);
    
    if (body && body.length < 500) {
        console.log(`Body: ${body.substring(0, 200)}...`);
    }
    
    res.json({
        status: 'received',
        timestamp: Date.now(),
        requestId: requestId
    });
});

// API: OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const requestId = 'ota_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    device.otaActive = true;
    device.otaProgress = 0;
    device.otaRequestId = requestId;
    
    // OTA komutunu kuyruğa ekle
    if (!device.queue) device.queue = [];
    device.queue.push({
        type: 'ota_start',
        requestId: requestId,
        size: 0, // Gerçek boyut sonradan gelecek
        timestamp: Date.now()
    });
    
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        requestId: requestId,
        message: 'OTA started'
    });
});

// API: OTA durum sorgula
app.get('/api/ota/status/:deviceId', (req, res) => {
    const device = devices.get(req.params.deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
        active: device.otaActive || false,
        progress: device.otaProgress || 0,
        requestId: device.otaRequestId || null
    });
});

// API: OTA chunk gönder
app.post('/api/ota/chunk', (req, res) => {
    const { deviceId, requestId, offset, size, data } = req.body;
    
    const device = devices.get(deviceId);
    if (!device || !device.otaActive) {
        return res.status(400).json({ error: 'OTA not active for this device' });
    }
    
    // Progress'i güncelle (simülasyon)
    const newProgress = Math.min(100, Math.floor((offset + size) / 1024));
    
    device.otaProgress = newProgress;
    
    // Chunk komutunu kuyruğa ekle
    if (!device.queue) device.queue = [];
    device.queue.push({
        type: 'ota_chunk',
        requestId: requestId,
        offset: offset,
        size: size,
        data: data,
        timestamp: Date.now()
    });
    
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        progress: newProgress,
        bytesSent: offset + size,
        nextOffset: offset + size
    });
});

// API: OTA finalize
app.post('/api/ota/finalize', (req, res) => {
    const { deviceId, requestId } = req.body;
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    // Finalize komutunu kuyruğa ekle
    if (!device.queue) device.queue = [];
    device.queue.push({
        type: 'ota_finalize',
        requestId: requestId,
        timestamp: Date.now()
    });
    
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        message: 'OTA finalize command queued'
    });
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    device.otaActive = false;
    device.otaProgress = 0;
    
    // İptal komutunu kuyruğa ekle
    if (!device.queue) device.queue = [];
    device.queue.push({
        type: 'ota_cancel',
        requestId: device.otaRequestId || 'none',
        timestamp: Date.now()
    });
    
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        message: 'OTA cancelled'
    });
});

// API: Komut gönder (dashboard'dan cihaza komut göndermek için)
app.post('/api/command', (req, res) => {
    const { deviceId, command } = req.body;
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    // Komutu cihazın kuyruğuna ekle
    if (!device.queue) {
        device.queue = [];
    }
    
    device.queue.push({
        type: 'custom_command',
        command: command,
        timestamp: Date.now(),
        id: 'cmd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
    });
    
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        message: `Komut '${command}' cihaza gönderildi`,
        queueLength: device.queue.length
    });
});

// API: Kuyruktaki komutları getir (ESP32 için)
app.get('/api/queue/:deviceId', (req, res) => {
    const device = devices.get(req.params.deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const queue = device.queue || [];
    
    // Komutları gönderdikten sonra kuyruğu temizle
    device.queue = [];
    devices.set(req.params.deviceId, device);
    
    res.json({
        commands: queue,
        timestamp: Date.now()
    });
});

// API: Dosya yükleme
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Dosyayı oku
    const fileData = fs.readFileSync(req.file.path);
    const fileSize = req.file.size;
    
    // Geçici olarak base64'e çevir (demo için)
    const base64Data = fileData.toString('base64');
    
    res.json({
        success: true,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        data: base64Data.substring(0, 100) + '...' // Demo için sadece ilk 100 karakter
    });
});

// API: Test endpoint
app.get('/test/device/:deviceId', (req, res) => {
    const device = devices.get(req.params.deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const isOnline = (Date.now() - device.lastSeen) < 30000;
    
    res.json({
        deviceId: req.params.deviceId,
        online: isOnline,
        lastSeen: device.lastSeen,
        lastSeenAgo: Date.now() - device.lastSeen,
        ip: device.ip,
        model: device.model,
        location: device.location,
        chipId: device.chipId
    });
});

// Test sayfası
app.get('/test/html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Page</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                pre { background: #f0f0f0; padding: 10px; }
                .chip-warning { color: #f44336; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>Test Page</h1>
            <h2>Cihazlar (${devices.size}):</h2>
            <pre>${JSON.stringify(Array.from(devices.entries()), null, 2)}</pre>
            
            <h2>Chip ID Kontrolü:</h2>
            ${Array.from(devices.entries()).map(([id, device]) => `
                <p>${id}: ${device.chipId} 
                ${(!device.chipId || device.chipId === 'unknown' || device.chipId === '0') ? 
                    '<span class="chip-warning">(Geçersiz Chip ID!)</span>' : ''}
                </p>
            `).join('')}
            
            <a href="/">Home</a> | <a href="/dashboard">Dashboard</a>
        </body>
        </html>
    `);
});

// Cihaz detay sayfası
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (!device) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cihaz Bulunamadı</title>
                <style>
                    body { font-family: sans-serif; padding: 40px; text-align: center; }
                    .container { max-width: 600px; margin: 0 auto; }
                    h1 { color: #f44336; }
                    .btn { display: inline-block; padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔍 Cihaz Bulunamadı</h1>
                    <p><strong>${deviceId}</strong> ID'li cihaz bulunamadı.</p>
                    <a href="/dashboard" class="btn">Dashboard'a Dön</a>
                    <a href="/" class="btn">Ana Sayfa</a>
                </div>
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
            <title>${deviceId} - Cihaz Detayı</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #1a237e; }
                .status { display: inline-block; padding: 5px 15px; border-radius: 20px; color: white; font-weight: bold; }
                .online { background: #4CAF50; }
                .offline { background: #f44336; }
                .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
                .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
                .info-item { margin: 10px 0; }
                .label { font-weight: bold; color: #555; }
                .value { color: #1a237e; }
                .btn { display: inline-block; padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${deviceId}</h1>
                <span class="status ${isOnline ? 'online' : 'offline'}">${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}</span>
                
                <div class="info-grid">
                    <div class="info-card">
                        <h3>📊 Temel Bilgiler</h3>
                        <div class="info-item"><span class="label">Model:</span> <span class="value">${device.model || 'ESP32-S3'}</span></div>
                        <div class="info-item"><span class="label">Konum:</span> <span class="value">${device.location || 'Unknown'}</span></div>
                        <div class="info-item"><span class="label">Amaç:</span> <span class="value">${device.purpose || 'General'}</span></div>
                        <div class="info-item"><span class="label">Chip ID:</span> <span class="value">${device.chipId || 'unknown'}</span></div>
                    </div>
                    
                    <div class="info-card">
                        <h3>🌐 Ağ Bilgileri</h3>
                        <div class="info-item"><span class="label">IP Adresi:</span> <span class="value">${device.ip || 'N/A'}</span></div>
                        <div class="info-item"><span class="label">MAC Adresi:</span> <span class="value">${device.mac || 'unknown'}</span></div>
                        <div class="info-item"><span class="label">Son Görülme:</span> <span class="value">${new Date(device.lastSeen).toLocaleString('tr-TR')}</span></div>
                        <div class="info-item"><span class="label">Kayıt Tarihi:</span> <span class="value">${new Date(device.registeredAt).toLocaleString('tr-TR')}</span></div>
                    </div>
                    
                    <div class="info-card">
                        <h3>⚙️ Sistem Durumu</h3>
                        <div class="info-item"><span class="label">Firmware:</span> <span class="value">${device.firmware || 'unknown'}</span></div>
                        <div class="info-item"><span class="label">Boş Heap:</span> <span class="value">${device.heap ? Math.round(device.heap/1024) + ' KB' : 'N/A'}</span></div>
                        <div class="info-item"><span class="label">OTA Durumu:</span> <span class="value">${device.otaActive ? `Aktif (${device.otaProgress || 0}%)` : 'Aktif Değil'}</span></div>
                        <div class="info-item"><span class="label">Session ID:</span> <span class="value" style="font-size: 0.8em;">${device.sessionId || 'none'}</span></div>
                    </div>
                </div>
                
                <div style="margin-top: 30px;">
                    <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                    <a href="/api/device/${deviceId}" class="btn" target="_blank">📡 JSON Görüntüle</a>
                    <a href="/test/device/${deviceId}" class="btn">🧪 Test Et</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Server başlatma
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🏠 Home: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`❤️  Health: http://localhost:${PORT}/health`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`  GET  /api/devices          - Tüm cihazları listele`);
    console.log(`  GET  /api/device/:id       - Tek cihaz detayı`);
    console.log(`  POST /api/register         - Cihaz kaydı`);
    console.log(`  POST /api/poll             - Komut poll et`);
    console.log(`  POST /api/response         - Yanıt gönder`);
    console.log(`  GET  /health               - Health check`);
});
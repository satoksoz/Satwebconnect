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
app.use(express.static('public'));  // public klasörünü statik dosyalar için kullan
app.use(express.urlencoded({ extended: true }));

// Dashboard sayfası - public/dashboard.html dosyasını sun
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

// API: Tüm cihazları listele
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([deviceId, device]) => ({
        deviceId,
        ...device,
        online: (Date.now() - device.lastSeen) < 30000
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
        sdkVersion 
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
        // Yine de kaydedebiliriz, sadece warning
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
        otaProgress: 0
    });
    
    console.log(`✅ Registered/Updated device: ${deviceId}`);
    console.log(`   Model: ${model || 'ESP32-S3'}`);
    console.log(`   Location: ${location || 'Unknown'}`);
    console.log(`   Purpose: ${purpose || 'General'}`);
    console.log(`   Session: ${sessionId}`);
    console.log(`   Total devices now: ${devices.size}`);
    
    // Tüm cihazları listele
    console.log('📋 All registered devices:');
    devices.forEach((device, id) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        console.log(`   ${id} - ${isOnline ? '🟢' : '🔴'} ${device.location} (${device.model})`);
    });
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now(),
        serverUrl: req.protocol + '://' + req.get('host'),
        message: 'Device registered successfully',
        totalDevices: devices.size
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
    
    device.otaActive = false;
    device.otaProgress = 100;
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        message: 'OTA completed'
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
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        message: 'OTA cancelled'
    });
});

// API: Dosya yükleme
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        path: req.file.path
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
        location: device.location
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
            </style>
        </head>
        <body>
            <h1>Test Page</h1>
            <pre>Devices: ${JSON.stringify(Array.from(devices.entries()), null, 2)}</pre>
            <a href="/">Home</a> | <a href="/dashboard">Dashboard</a>
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
});
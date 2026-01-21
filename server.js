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

// Dashboard sayfası
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
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
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${deviceId} - Cihaz Detayı</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; padding: 20px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .header { background: linear-gradient(135deg, #1a237e 0%, #311b92 100%); color: white; padding: 25px; border-radius: 15px 15px 0 0; }
                .header h1 { font-size: 2em; margin-bottom: 10px; }
                .status-badge { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold; margin-left: 15px; }
                .status-badge.online { background: #4CAF50; color: white; }
                .status-badge.offline { background: #f44336; color: white; }
                .content { background: white; padding: 30px; border-radius: 0 0 15px 15px; box-shadow: 0 5px 20px rgba(0,0,0,0.1); }
                .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .info-card { background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #2196F3; }
                .info-card h3 { color: #1a237e; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
                .info-item { margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
                .info-item:last-child { border-bottom: none; }
                .actions { display: flex; gap: 15px; flex-wrap: wrap; margin-top: 30px; }
                .btn { padding: 12px 25px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; text-decoration: none; }
                .btn-primary { background: #2196F3; color: white; }
                .btn-secondary { background: #6c757d; color: white; }
                .btn-success { background: #4CAF50; color: white; }
                .btn-warning { background: #FF9800; color: white; }
                .btn:hover { opacity: 0.9; transform: translateY(-2px); }
                .last-seen { font-size: 0.9em; color: #666; margin-top: 5px; }
                .chip-id-warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; color: #856404; }
            </style>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>
                        <i class="fas fa-microchip"></i>
                        ${deviceId}
                        <span class="status-badge ${isOnline ? 'online' : 'offline'}">
                            ${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                        </span>
                    </h1>
                    <p>${device.location || 'Bilinmeyen Konum'} • ${device.model || 'ESP32-S3'} • ${device.purpose || 'Genel Kullanım'}</p>
                </div>
                
                <div class="content">
                    ${device.chipId && device.chipId === 'unknown' || device.chipId === '0' ? 
                        `<div class="chip-id-warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Uyarı:</strong> Chip ID bilgisi alınamadı veya geçersiz. ESP32 kodunuzda chip ID okuma sorunu olabilir.
                        </div>` : ''
                    }
                    
                    <div class="info-grid">
                        <div class="info-card">
                            <h3><i class="fas fa-info-circle"></i> Temel Bilgiler</h3>
                            <div class="info-item">
                                <span>Model:</span>
                                <strong>${device.model || 'ESP32-S3'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Firmware:</span>
                                <strong>${device.firmware || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Chip ID:</span>
                                <strong>${device.chipId || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Chip Revision:</span>
                                <strong>${device.chipRevision || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>SDK Version:</span>
                                <strong>${device.sdkVersion || 'Bilinmiyor'}</strong>
                            </div>
                        </div>
                        
                        <div class="info-card">
                            <h3><i class="fas fa-network-wired"></i> Ağ Bilgileri</h3>
                            <div class="info-item">
                                <span>IP Adresi:</span>
                                <strong>${device.ip || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>MAC Adresi:</span>
                                <strong>${device.mac || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Son Görülme:</span>
                                <strong>${new Date(device.lastSeen).toLocaleString('tr-TR')}</strong>
                            </div>
                            <div class="last-seen">
                                (${Math.round((Date.now() - device.lastSeen) / 1000)} saniye önce)
                            </div>
                        </div>
                        
                        <div class="info-card">
                            <h3><i class="fas fa-memory"></i> Sistem Durumu</h3>
                            <div class="info-item">
                                <span>Boş Heap:</span>
                                <strong>${device.heap ? Math.round(device.heap/1024) + ' KB' : 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Flash Boyutu:</span>
                                <strong>${device.flash ? Math.round(device.flash/1024) + ' KB' : 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Kayıt Tarihi:</span>
                                <strong>${new Date(device.registeredAt).toLocaleString('tr-TR')}</strong>
                            </div>
                            <div class="info-item">
                                <span>Session ID:</span>
                                <strong style="font-size: 0.85em;">${device.sessionId || 'Bilinmiyor'}</strong>
                            </div>
                        </div>
                        
                        <div class="info-card">
                            <h3><i class="fas fa-cogs"></i> Özellikler</h3>
                            <div class="info-item">
                                <span>Konum:</span>
                                <strong>${device.location || 'Bilinmeyen'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Amaç:</span>
                                <strong>${device.purpose || 'Genel'}</strong>
                            </div>
                            <div class="info-item">
                                <span>Özellikler:</span>
                                <strong>${device.features || 'Bilinmiyor'}</strong>
                            </div>
                            <div class="info-item">
                                <span>OTA Durumu:</span>
                                <strong>${device.otaActive ? `Aktif (${device.otaProgress || 0}%)` : 'Aktif Değil'}</strong>
                            </div>
                        </div>
                    </div>
                    
                    <div class="actions">
                        <a href="/dashboard" class="btn btn-secondary">
                            <i class="fas fa-arrow-left"></i> Dashboard'a Dön
                        </a>
                        <button onclick="openOTA('${deviceId}')" class="btn btn-success" ${!isOnline ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            <i class="fas fa-upload"></i> OTA Güncelleme
                        </button>
                        <button onclick="sendCommand('${deviceId}', 'restart')" class="btn btn-warning" ${!isOnline ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            <i class="fas fa-redo"></i> Yeniden Başlat
                        </button>
                        <button onclick="sendCommand('${deviceId}', 'info')" class="btn btn-primary" ${!isOnline ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            <i class="fas fa-sync"></i> Bilgi Güncelle
                        </button>
                        <a href="/api/device/${deviceId}" target="_blank" class="btn btn-secondary">
                            <i class="fas fa-code"></i> JSON Görüntüle
                        </a>
                    </div>
                </div>
            </div>
            
            <script>
                function openOTA(deviceId) {
                    window.open('/dashboard', '_blank');
                    // Dashboard'daki OTA modal'ını tetiklemek için
                    if (window.opener) {
                        window.opener.openOTAModal(deviceId);
                    } else {
                        alert('Dashboard sayfasında OTA butonuna tıklayın');
                    }
                }
                
                async function sendCommand(deviceId, command) {
                    try {
                        const response = await fetch('/api/command', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ deviceId, command })
                        });
                        const result = await response.json();
                        alert(result.message || 'Komut gönderildi');
                        location.reload();
                    } catch (error) {
                        alert('Komut gönderilemedi: ' + error.message);
                    }
                }
            </script>
        </body>
        </html>
    `);
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
                .device-list { margin-top: 30px; }
                .device-item { padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
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
                    
                    ${devices.size > 0 ? `
                        <div class="device-list">
                            <h3>Kayıtlı Cihazlar:</h3>
                            ${Array.from(devices.entries()).map(([id, device]) => `
                                <div class="device-item">
                                    <span>${id}</span>
                                    <span>
                                        ${(Date.now() - device.lastSeen) < 30000 ? '🟢' : '🔴'}
                                        <a href="/device/${id}">Detay</a>
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
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
        onlineDevices: Array.from(devices.values()).filter(d => (Date.now() - d.lastSeen) < 30000).length,
        chipIdIssues: Array.from(devices.entries())
            .filter(([id, device]) => !device.chipId || device.chipId === 'unknown' || device.chipId === '0')
            .map(([id, device]) => ({ deviceId: id, chipId: device.chipId }))
    });
});

// API: Tüm cihazları listele
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([deviceId, device]) => ({
        deviceId,
        ...device,
        online: (Date.now() - device.lastSeen) < 30000,
        lastSeenAgo: Math.round((Date.now() - device.lastSeen) / 1000)
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
        online: (Date.now() - device.lastSeen) < 30000,
        lastSeenAgo: Math.round((Date.now() - device.lastSeen) / 1000)
    });
});

// API: Komut gönder
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
    
    // Chip ID kontrolü
    if (!chipId || chipId === '0' || chipId === 'unknown') {
        console.log('WARN: Invalid or missing chipId:', chipId);
        // Chip ID olmayan cihazlar için özel ID oluştur
        const fallbackChipId = 'chip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        chipId = fallbackChipId;
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
        chipId: chipId,
        chipRevision: chipRevision || 0,
        sdkVersion: sdkVersion || 'unknown',
        otaActive: false,
        otaProgress: 0,
        rssi: req.body.rssi || null
    });
    
    console.log(`✅ Registered/Updated device: ${deviceId}`);
    console.log(`   Model: ${model || 'ESP32-S3'}`);
    console.log(`   Location: ${location || 'Unknown'}`);
    console.log(`   Chip ID: ${chipId}`);
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

// API: Cihaz ping
app.post('/api/ping', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    device.lastSeen = Date.now();
    devices.set(deviceId, device);
    
    res.json({
        success: true,
        timestamp: Date.now(),
        queue: device.queue || []
    });
});

// OTA endpoint'leri...
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

app.post('/api/ota/chunk', (req, res) => {
    const { deviceId, requestId, offset, size, data } = req.body;
    
    const device = devices.get(deviceId);
    if (!device || !device.otaActive) {
        return res.status(400).json({ error: 'OTA not active for this device' });
    }
    
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
    console.log(`\n⚠️  ESP32 Chip ID Notu: ESP32'den chip ID okumak için kodda doğru fonksiyon kullanılmalıdır.`);
    console.log(`   Chip ID alınamıyorsa, ESP32 kodunuzu kontrol edin.`);
});
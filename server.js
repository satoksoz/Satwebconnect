const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Multer için upload klasörü
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

// Cihaz verileri
const devices = new Map(); // deviceId -> {ws, info}
const otaSessions = new Map(); // deviceId -> {filePath, progress}

// WebSocket bağlantısı
wss.on('connection', (ws, req) => {
    console.log('🔌 Yeni WebSocket bağlantısı');
    
    // Device ID'yi URL'den al
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId');
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        console.log('❌ Geçersiz Device ID');
        ws.close(1008, 'Invalid Device ID');
        return;
    }
    
    console.log(`✅ Cihaz bağlandı: ${deviceId}`);
    
    // Cihazı kaydet
    devices.set(deviceId, {
        ws: ws,
        connected: true,
        lastSeen: Date.now(),
        ip: req.socket.remoteAddress,
        deviceId: deviceId
    });
    
    // Heartbeat
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);
    
    // Mesaj işleme
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            // Cihaz durumunu güncelle
            const device = devices.get(deviceId);
            if (device) {
                device.lastSeen = Date.now();
            }
            
            switch(msg.type) {
                case 'hello':
                    console.log(`👋 Hello from ${deviceId}`);
                    break;
                    
                case 'pong':
                    break;
                    
                case 'response':
                    // HTTP response
                    handleHTTPResponse(msg);
                    break;
                    
                case 'ota_response':
                    // OTA response
                    handleOTAResponse(deviceId, msg);
                    break;
            }
            
        } catch (err) {
            console.error('❌ Mesaj parse hatası:', err);
        }
    });
    
    ws.on('pong', () => {
        const device = devices.get(deviceId);
        if (device) device.lastSeen = Date.now();
    });
    
    ws.on('close', () => {
        console.log(`🔌 Cihaz bağlantısı kapandı: ${deviceId}`);
        clearInterval(pingInterval);
        const device = devices.get(deviceId);
        if (device) device.connected = false;
    });
});

// OTA yanıt işleme
function handleOTAResponse(deviceId, msg) {
    const session = otaSessions.get(deviceId);
    if (!session) return;
    
    const device = devices.get(deviceId);
    if (!device || !device.ws) return;
    
    switch(msg.status) {
        case 'ready':
            // ESP32 OTA'ya hazır, ilk chunk'ı gönder
            sendOTAChunk(deviceId, session, 0);
            break;
            
        case 'chunk_ok':
            // Chunk başarıyla alındı, bir sonrakini gönder
            const nextOffset = msg.next_offset || (session.sent + session.chunkSize);
            if (nextOffset < session.fileSize) {
                session.sent = nextOffset;
                session.progress = Math.round((session.sent / session.fileSize) * 100);
                sendOTAChunk(deviceId, session, nextOffset);
            } else {
                // Tüm dosya gönderildi
                device.ws.send(JSON.stringify({
                    type: 'ota_command',
                    command: 'finalize'
                }));
                session.progress = 100;
            }
            break;
            
        case 'error':
            console.error(`❌ OTA hatası (${deviceId}):`, msg.error);
            otaSessions.delete(deviceId);
            break;
            
        case 'success':
            console.log(`✅ OTA başarılı: ${deviceId}`);
            otaSessions.delete(deviceId);
            // Dosyayı temizle
            if (session.filePath && fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
            break;
    }
}

// OTA chunk gönderme
function sendOTAChunk(deviceId, session, offset) {
    const device = devices.get(deviceId);
    if (!device || !device.ws) return;
    
    const chunkSize = Math.min(session.chunkSize, session.fileSize - offset);
    
    fs.readFile(session.filePath, (err, data) => {
        if (err) {
            console.error('❌ Dosya okuma hatası:', err);
            return;
        }
        
        const chunk = data.slice(offset, offset + chunkSize);
        const chunkBase64 = chunk.toString('base64');
        
        device.ws.send(JSON.stringify({
            type: 'ota_command',
            command: 'write',
            offset: offset,
            size: chunkSize,
            data: chunkBase64,
            total_size: session.fileSize
        }));
        
        console.log(`📤 OTA chunk gönderildi: ${deviceId} - ${offset}/${session.fileSize}`);
    });
}

// HTTP yanıt işleme
const pendingRequests = new Map();

function handleHTTPResponse(msg) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
        pendingRequests.delete(msg.requestId);
        clearTimeout(pending.timeout);
        
        if (msg.status === 200) {
            pending.res
                .status(200)
                .set('Content-Type', msg.contentType || 'text/html')
                .send(msg.body);
        } else {
            pending.res.status(404).send('Sayfa bulunamadı');
        }
    }
}

// Static dosyalar
app.use(express.static('public'));

// Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API: Online cihazları listele
app.get('/api/devices', (req, res) => {
    const onlineDevices = [];
    
    devices.forEach((device, deviceId) => {
        const isOnline = device.connected && (Date.now() - device.lastSeen) < 60000;
        const otaActive = otaSessions.has(deviceId);
        
        onlineDevices.push({
            deviceId,
            online: isOnline,
            lastSeen: device.lastSeen,
            ip: device.ip,
            otaActive: otaActive,
            otaProgress: otaActive ? otaSessions.get(deviceId).progress : 0
        });
    });
    
    res.json(onlineDevices);
});

// API: Firmware dosyası yükle
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Dosya seçilmedi' });
        }
        
        const { deviceId } = req.body;
        if (!deviceId) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Cihaz ID gerekli' });
        }
        
        // Dosya bilgileri
        const stats = fs.statSync(req.file.path);
        const fileSize = stats.size;
        
        // OTA session oluştur
        otaSessions.set(deviceId, {
            filePath: req.file.path,
            fileSize: fileSize,
            sent: 0,
            progress: 0,
            chunkSize: 4096,
            startedAt: Date.now()
        });
        
        res.json({
            success: true,
            message: 'Firmware yüklendi',
            filename: req.file.originalname,
            size: fileSize,
            deviceId: deviceId
        });
        
    } catch (error) {
        console.error('❌ Upload hatası:', error);
        res.status(500).json({ error: 'Upload hatası' });
    }
});

// API: OTA başlat
app.post('/api/ota/start', express.json(), (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Cihaz ID gerekli' });
    }
    
    const session = otaSessions.get(deviceId);
    if (!session) {
        return res.status(404).json({ error: 'OTA session bulunamadı' });
    }
    
    const device = devices.get(deviceId);
    if (!device || !device.ws || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(503).json({ error: 'Cihaz çevrimdışı' });
    }
    
    // OTA başlatma komutu
    device.ws.send(JSON.stringify({
        type: 'ota_command',
        command: 'begin',
        size: session.fileSize,
        chunk_size: session.chunkSize
    }));
    
    res.json({
        success: true,
        message: 'OTA başlatıldı',
        deviceId: deviceId
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const session = otaSessions.get(deviceId);
    
    if (!session) {
        return res.json({ active: false });
    }
    
    res.json({
        active: true,
        progress: session.progress,
        sent: session.sent,
        total: session.fileSize,
        speed: session.fileSize / ((Date.now() - session.startedAt) / 1000)
    });
});

// API: OTA iptal
app.post('/api/ota/cancel', express.json(), (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Cihaz ID gerekli' });
    }
    
    const session = otaSessions.get(deviceId);
    if (session) {
        // Dosyayı sil
        if (fs.existsSync(session.filePath)) {
            fs.unlinkSync(session.filePath);
        }
        // Session'ı temizle
        otaSessions.delete(deviceId);
        
        // Cihaza iptal mesajı gönder
        const device = devices.get(deviceId);
        if (device && device.ws && device.ws.readyState === WebSocket.OPEN) {
            device.ws.send(JSON.stringify({
                type: 'ota_command',
                command: 'cancel'
            }));
        }
    }
    
    res.json({ success: true, message: 'OTA iptal edildi' });
});

// Cihaz HTML proxy
app.get('/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const filePath = req.params[0] || 'index.html';
    
    console.log(`🌐 ${deviceId} için istek: ${filePath}`);
    
    // Cihaz kontrolü
    const device = devices.get(deviceId);
    const isOnline = device && 
                    device.connected && 
                    (Date.now() - device.lastSeen) < 60000;
    
    if (!isOnline || !device.ws || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(503).send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: #f44336;">🔴 Cihaz Çevrimdışı</h1>
                <p><strong>${deviceId}</strong> bağlı değil</p>
                <a href="/" style="color: #2196F3;">← Dashboard'a dön</a>
            </body>
            </html>
        `);
    }
    
    // Request ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // ESP32'ye istek gönder
    const requestMsg = {
        type: 'request',
        requestId: requestId,
        method: 'GET',
        path: filePath
    };
    
    try {
        device.ws.send(JSON.stringify(requestMsg));
        
        // Yanıt bekle
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('Zaman aşımı'));
            }, 10000);
            
            pendingRequests.set(requestId, {
                res: res,
                timeout: timeout,
                resolve: resolve
            });
        });
        
    } catch (error) {
        console.error(`❌ ${deviceId} zaman aşımı:`, error);
        res.status(504).send(`
            <html>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: #ff9800;">⏱️ Zaman Aşımı</h1>
                <p>Cihaz yanıt vermedi</p>
                <a href="/" style="color: #2196F3;">← Dashboard'a dön</a>
            </body>
            </html>
        `);
    }
});

// Ana sayfa yönlendirme
app.get('/:deviceId', (req, res) => {
    res.redirect(`/${req.params.deviceId}/index.html`);
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        devices: devices.size,
        timestamp: new Date().toISOString()
    });
});

// Temizleyici
setInterval(() => {
    const now = Date.now();
    
    // Eski cihazları temizle
    devices.forEach((device, deviceId) => {
        if (now - device.lastSeen > 120000) {
            console.log(`🧹 Eski cihaz temizlendi: ${deviceId}`);
            devices.delete(deviceId);
        }
    });
    
    // Eski OTA session'ları temizle
    otaSessions.forEach((session, deviceId) => {
        if (now - session.startedAt > 300000) { // 5 dakika
            console.log(`🧹 Eski OTA session temizlendi: ${deviceId}`);
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
            otaSessions.delete(deviceId);
        }
    });
}, 30000);

// Server başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server ${PORT} portunda çalışıyor`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
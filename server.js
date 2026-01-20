const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Multer ayarları - OTA yükleme için
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.bin');
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/octet-stream' || 
            file.originalname.endsWith('.bin')) {
            cb(null, true);
        } else {
            cb(new Error('Sadece .bin dosyaları yüklenebilir'), false);
        }
    }
});

// Cihaz depolama
const devices = new Map();
const deviceStatus = new Map();

// OTA işlemleri için
const otaSessions = new Map(); // deviceId -> { filePath, totalSize, transferred, chunkSize }

// WebSocket bağlantı yönetimi
wss.on('connection', (ws, req) => {
    console.log('Yeni WebSocket bağlantısı');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId');
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        console.log('Geçersiz Device ID');
        ws.close(1008, 'Geçersiz Device ID');
        return;
    }
    
    console.log(`Cihaz bağlandı: ${deviceId}`);
    
    // Cihazı kaydet
    devices.set(deviceId, ws);
    deviceStatus.set(deviceId, {
        lastSeen: Date.now(),
        connected: true,
        ip: req.socket.remoteAddress,
        deviceId: deviceId
    });
    
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);
    
    // Mesaj işleme - OTA mesajları eklendi
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'pong') {
                deviceStatus.get(deviceId).lastSeen = Date.now();
            }
            else if (message.type === 'response') {
                const pendingReq = pendingRequests.get(message.requestId);
                if (pendingReq) {
                    pendingRequests.delete(message.requestId);
                    
                    if (message.status === 200) {
                        pendingReq.res
                            .status(200)
                            .set('Content-Type', message.contentType || 'text/html')
                            .send(message.body);
                    } else {
                        pendingReq.res.status(404).send('Sayfa bulunamadı');
                    }
                }
            }
            else if (message.type === 'ota_response') {
                // ESP32'den gelen OTA yanıtı
                handleOTAResponse(deviceId, message);
            }
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
        }
    });
    
    ws.on('pong', () => {
        deviceStatus.get(deviceId).lastSeen = Date.now();
    });
    
    ws.on('close', () => {
        console.log(`Cihaz bağlantısı kapandı: ${deviceId}`);
        clearInterval(pingInterval);
        devices.delete(deviceId);
        const status = deviceStatus.get(deviceId);
        if (status) {
            status.connected = false;
        }
        // OTA session'ı temizle
        otaSessions.delete(deviceId);
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket hatası (${deviceId}):`, error);
        clearInterval(pingInterval);
        otaSessions.delete(deviceId);
    });
});

// OTA yanıt işleme
function handleOTAResponse(deviceId, message) {
    const session = otaSessions.get(deviceId);
    if (!session) {
        console.log(`OTA session bulunamadı: ${deviceId}`);
        return;
    }
    
    const deviceWs = devices.get(deviceId);
    if (!deviceWs) {
        console.log(`Cihaz bulunamadı: ${deviceId}`);
        return;
    }
    
    if (message.status === 'ready') {
        // ESP32 OTA'ya hazır, ilk chunk'ı gönder
        sendOTAChunk(deviceId, deviceWs, session, 0);
    }
    else if (message.status === 'chunk_received') {
        // Bir chunk başarıyla alındı, bir sonrakini gönder
        const nextOffset = message.next_offset || (session.transferred + session.chunkSize);
        
        if (nextOffset < session.totalSize) {
            session.transferred = nextOffset;
            sendOTAChunk(deviceId, deviceWs, session, nextOffset);
        } else {
            // Tüm dosya gönderildi
            console.log(`OTA tamamlandı: ${deviceId}`);
            
            // Finalize mesajı gönder
            deviceWs.send(JSON.stringify({
                type: 'ota_command',
                command: 'finalize'
            }));
            
            // Session'ı temizle
            setTimeout(() => {
                otaSessions.delete(deviceId);
                try {
                    fs.unlinkSync(session.filePath);
                } catch (err) {
                    console.error('Dosya silinemedi:', err);
                }
            }, 5000);
        }
    }
    else if (message.status === 'error') {
        console.error(`OTA hatası (${deviceId}):`, message.error);
        otaSessions.delete(deviceId);
        try {
            fs.unlinkSync(session.filePath);
        } catch (err) {
            console.error('Dosya silinemedi:', err);
        }
    }
    else if (message.status === 'success') {
        console.log(`OTA başarıyla tamamlandı: ${deviceId}`);
        otaSessions.delete(deviceId);
        try {
            fs.unlinkSync(session.filePath);
        } catch (err) {
            console.error('Dosya silinemedi:', err);
        }
    }
}

// OTA chunk gönderme
function sendOTAChunk(deviceId, ws, session, offset) {
    const chunkSize = Math.min(session.chunkSize, session.totalSize - offset);
    
    fs.readFile(session.filePath, { encoding: null }, (err, data) => {
        if (err) {
            console.error('Dosya okuma hatası:', err);
            return;
        }
        
        const chunk = data.slice(offset, offset + chunkSize);
        const chunkBase64 = chunk.toString('base64');
        
        const otaMessage = {
            type: 'ota_command',
            command: 'write',
            offset: offset,
            size: chunkSize,
            data: chunkBase64,
            total_size: session.totalSize
        };
        
        ws.send(JSON.stringify(otaMessage));
        
        // İlerleme durumunu güncelle
        session.transferred = offset + chunkSize;
        const progress = Math.round((session.transferred / session.totalSize) * 100);
        
        console.log(`OTA ilerleme (${deviceId}): ${progress}%`);
    });
}

// Bekleyen istekler
const pendingRequests = new Map();
let requestCounter = 0;

// API Route'ları - OTA endpoint'leri eklendi
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/devices', (req, res) => {
    const onlineDevices = [];
    
    deviceStatus.forEach((status, deviceId) => {
        const isOnline = status.connected && 
                        (Date.now() - status.lastSeen) < 60000;
        
        onlineDevices.push({
            deviceId,
            online: isOnline,
            lastSeen: status.lastSeen,
            ip: status.ip,
            otaInProgress: otaSessions.has(deviceId)
        });
    });
    
    res.json(onlineDevices);
});

// OTA yükleme endpoint'i
app.post('/api/ota/upload', upload.single('firmware'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Dosya yüklenemedi' });
        }
        
        const { deviceId } = req.body;
        
        if (!deviceId) {
            // Dosyayı sil
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Device ID gerekli' });
        }
        
        // Dosya bilgilerini al
        const stats = fs.statSync(req.file.path);
        const fileSize = stats.size;
        
        // OTA session oluştur
        otaSessions.set(deviceId, {
            filePath: req.file.path,
            totalSize: fileSize,
            transferred: 0,
            chunkSize: 4096, // 4KB chunk boyutu
            startedAt: Date.now()
        });
        
        res.json({
            success: true,
            message: 'Dosya başarıyla yüklendi',
            filename: req.file.originalname,
            size: fileSize,
            deviceId: deviceId
        });
        
    } catch (error) {
        console.error('OTA yükleme hatası:', error);
        res.status(500).json({ error: 'OTA yükleme sırasında hata' });
    }
});

// OTA başlatma endpoint'i
app.post('/api/ota/start', express.json(), (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const session = otaSessions.get(deviceId);
    if (!session) {
        return res.status(404).json({ error: 'OTA session bulunamadı' });
    }
    
    const deviceWs = devices.get(deviceId);
    if (!deviceWs || deviceWs.readyState !== WebSocket.OPEN) {
        return res.status(503).json({ error: 'Cihaz çevrimdışı' });
    }
    
    // OTA başlatma komutunu gönder
    const otaStartMessage = {
        type: 'ota_command',
        command: 'begin',
        size: session.totalSize,
        chunk_size: session.chunkSize
    };
    
    deviceWs.send(JSON.stringify(otaStartMessage));
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        fileSize: session.totalSize
    });
});

// OTA durum sorgulama
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const session = otaSessions.get(deviceId);
    
    if (!session) {
        return res.json({ inProgress: false });
    }
    
    const progress = Math.round((session.transferred / session.totalSize) * 100);
    const elapsed = Date.now() - session.startedAt;
    const speed = elapsed > 0 ? Math.round((session.transferred / elapsed) * 1000) : 0; // bytes/sec
    
    res.json({
        inProgress: true,
        progress: progress,
        transferred: session.transferred,
        totalSize: session.totalSize,
        speed: speed,
        elapsedTime: Math.round(elapsed / 1000),
        estimatedTime: speed > 0 ? Math.round((session.totalSize - session.transferred) / speed) : 0
    });
});

// OTA iptal
app.post('/api/ota/cancel', express.json(), (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const session = otaSessions.get(deviceId);
    if (session) {
        // Dosyayı sil
        try {
            fs.unlinkSync(session.filePath);
        } catch (err) {
            console.error('Dosya silinemedi:', err);
        }
        
        // Session'ı temizle
        otaSessions.delete(deviceId);
        
        // Cihaza iptal mesajı gönder
        const deviceWs = devices.get(deviceId);
        if (deviceWs && deviceWs.readyState === WebSocket.OPEN) {
            deviceWs.send(JSON.stringify({
                type: 'ota_command',
                command: 'cancel'
            }));
        }
    }
    
    res.json({ success: true, message: 'OTA iptal edildi' });
});

// Diğer route'lar (değişmedi)
app.get('/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const filePath = req.params[0] || 'index.html';
    
    const deviceWs = devices.get(deviceId);
    if (!deviceWs || deviceWs.readyState !== WebSocket.OPEN) {
        return res.status(503).send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>🔴 Cihaz Çevrimdışı</h1>
                    <p><strong>${deviceId}</strong> cihazı şu anda çevrimdışı.</p>
                    <p>Lütfen cihazın internete bağlı olduğundan emin olun.</p>
                    <a href="/">← Dashboard'a dön</a>
                </body>
            </html>
        `);
    }
    
    const requestId = `req_${Date.now()}_${++requestCounter}`;
    
    const requestMessage = {
        type: 'request',
        requestId: requestId,
        method: 'GET',
        path: filePath,
        headers: req.headers
    };
    
    try {
        deviceWs.send(JSON.stringify(requestMessage));
        
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('Timeout: Cihaz yanıt vermedi'));
            }, 10000);
            
            pendingRequests.set(requestId, {
                res: res,
                timeout: timeout,
                resolve: resolve,
                reject: reject
            });
        });
        
        await responsePromise;
        
    } catch (error) {
        console.error('İstek işleme hatası:', error);
        res.status(504).send('Gateway Timeout: Cihaz yanıt vermedi');
    }
});

app.get('/:deviceId', (req, res) => {
    res.redirect(`/${req.params.deviceId}/index.html`);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        deviceCount: devices.size,
        timestamp: new Date().toISOString()
    });
});

// Zaman aşımı temizleyici
setInterval(() => {
    const now = Date.now();
    pendingRequests.forEach((value, key) => {
        if (value.timeout._idleStart && (now - value.timeout._idleStart) > 10000) {
            value.res.status(504).send('Gateway Timeout');
            pendingRequests.delete(key);
        }
    });
    
    // Eski OTA session'larını temizle (30 dakikadan eski)
    otaSessions.forEach((session, deviceId) => {
        if (now - session.startedAt > 30 * 60 * 1000) {
            console.log(`Eski OTA session temizlendi: ${deviceId}`);
            try {
                fs.unlinkSync(session.filePath);
            } catch (err) {
                console.error('Dosya silinemedi:', err);
            }
            otaSessions.delete(deviceId);
        }
    });
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor`);
    console.log(`Dashboard: http://localhost:${PORT}`);
});
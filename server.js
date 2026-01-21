const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Body parser - TÜM endpoint'ler için
app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Tüm request'leri logla
app.use((req, res, next) => {
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// File upload
const upload = multer({ 
    dest: 'uploads/',
    limits: { 
        fileSize: 2 * 1024 * 1024,
        files: 1
    }
});

// Storage
const devices = new Map();
const pendingRequests = new Map();
const otaSessions = new Map();

// ============ STATIC FILES ============
app.use(express.static(__dirname));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
    console.log('Health check requested');
    res.json({
        status: 'ok',
        devices: devices.size,
        pendingRequests: pendingRequests.size,
        otaSessions: otaSessions.size,
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

// ============ DEBUG ENDPOINTS ============
app.get('/api/debug/pending', (req, res) => {
    const pendingList = [];
    
    pendingRequests.forEach((pending, requestId) => {
        pendingList.push({
            requestId: requestId,
            deviceId: pending.deviceId,
            age: Date.now() - pending.createdAt,
            path: pending.path || '/index.html',
            createdAt: new Date(pending.createdAt).toISOString()
        });
    });
    
    res.json({
        timestamp: new Date().toISOString(),
        pendingCount: pendingRequests.size,
        pendingRequests: pendingList,
        devicesCount: devices.size,
        devices: Array.from(devices.keys())
    });
});

app.get('/api/debug/devices', (req, res) => {
    const deviceList = [];
    
    devices.forEach((device, deviceId) => {
        deviceList.push({
            deviceId: deviceId,
            ip: device.ip,
            lastSeen: device.lastSeen,
            sessionId: device.sessionId,
            queueLength: device.queue.length,
            isOnline: (Date.now() - device.lastSeen) < 30000
        });
    });
    
    res.json(deviceList);
});

// ============ MAIN DASHBOARD ============
app.get('/', (req, res) => {
    console.log('Main dashboard accessed');
    
    let onlineDevices = 0;
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT Dashboard</title>
        <style>
            body { font-family: Arial; padding: 20px; background: #f5f5f5; }
            .device-card {
                background: white;
                border-radius: 10px;
                padding: 20px;
                margin: 15px 0;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                border-left: 5px solid #4CAF50;
            }
            .device-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            .device-id {
                font-weight: bold;
                font-size: 1.2em;
                color: #333;
            }
            .status {
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 0.9em;
                font-weight: bold;
            }
            .online { background: #e8f5e9; color: #2e7d32; }
            .offline { background: #ffebee; color: #c62828; }
            .btn {
                padding: 8px 16px;
                margin: 5px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                text-decoration: none;
                display: inline-block;
            }
            .btn-primary { background: #2196F3; color: white; }
            .btn-success { background: #4CAF50; color: white; }
        </style>
    </head>
    <body>
        <h1>SAT Web Connect Dashboard</h1>
        <p>Total devices: ${devices.size}</p>
        <div>
            <a href="/health" class="btn btn-primary">Health Check</a>
            <a href="/api/debug/pending" class="btn btn-primary">Debug Pending</a>
            <a href="/api/debug/devices" class="btn btn-primary">Debug Devices</a>
        </div>
    `;
    
    if (devices.size === 0) {
        html += '<p>No devices connected yet</p>';
    } else {
        devices.forEach((device, deviceId) => {
            const isOnline = (Date.now() - device.lastSeen) < 30000;
            if (isOnline) onlineDevices++;
            
            html += `
            <div class="device-card">
                <div class="device-header">
                    <div class="device-id">${deviceId}</div>
                    <div class="status ${isOnline ? 'online' : 'offline'}">
                        ${isOnline ? 'Online' : 'Offline'}
                    </div>
                </div>
                <p>IP: ${device.ip}</p>
                <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
                <div>
                    <a href="/device/${deviceId}" class="btn btn-primary">Access Device</a>
                    ${isOnline ? `<a href="/ota.html?device=${deviceId}" class="btn btn-success">OTA Update</a>` : ''}
                </div>
            </div>`;
        });
    }
    
    html += `
        <p>Online: ${onlineDevices} | Offline: ${devices.size - onlineDevices}</p>
        <script>
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// ============ OTA DASHBOARD ============
app.get('/ota.html', (req, res) => {
    const deviceId = req.query.device;
    console.log(`OTA dashboard for device: ${deviceId}`);
    
    if (!fs.existsSync('dashboard.html')) {
        return res.status(404).send('Dashboard file not found');
    }
    
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ============ DEVICE ACCESS ============
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`Device access requested: ${deviceId}`);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device || !isOnline) {
        console.log(`Device ${deviceId} is offline`);
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Device Offline</h1>
                <p>Device ${deviceId} is currently offline.</p>
                <a href="/">Go to Dashboard</a>
            </body></html>
        `);
    }
    
    console.log(`Device ${deviceId} is online, creating request`);
    
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'http_request',
        requestId: requestId,
        path: '/index.html',
        method: 'GET',
        timestamp: new Date().toISOString()
    };
    
    device.queue.push(command);
    
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            console.log(`Request timeout: ${requestId}`);
            res.status(504).send(`
                <html><body style="text-align:center;padding:50px;">
                    <h1>Timeout</h1>
                    <p>Device ${deviceId} didn't respond.</p>
                    <a href="/device/${deviceId}">Try Again</a>
                </body></html>
            `);
        }
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res,
        deviceId: deviceId,
        createdAt: Date.now(),
        path: '/index.html'
    });
    
    console.log(`Request ${requestId} created, waiting for response`);
});

app.get('/device/:deviceId/*', (req, res) => {
    const deviceId = req.params.deviceId;
    const requestedPath = req.params[0] || 'index.html';
    
    console.log(`Device path access: ${deviceId}/${requestedPath}`);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device || !isOnline) {
        return res.status(503).send('Device offline');
    }
    
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'http_request',
        requestId: requestId,
        path: '/' + requestedPath,
        method: 'GET',
        timestamp: new Date().toISOString()
    };
    
    device.queue.push(command);
    
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            res.status(504).send('Request timeout');
        }
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res,
        deviceId: deviceId,
        createdAt: Date.now(),
        path: requestedPath
    });
});

// ============ DEVICE REGISTRATION ============
app.post('/api/register', (req, res) => {
    console.log('\n=== REGISTER REQUEST ===');
    console.log('Body:', req.body);
    
    const { deviceId, ip } = req.body;
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        console.log('Invalid device ID:', deviceId);
        return res.status(400).json({ error: 'Invalid device ID' });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip || req.ip,
        lastSeen: Date.now(),
        queue: [],
        registeredAt: Date.now()
    });
    
    console.log(`Registered device: ${deviceId} with session ${sessionId}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now()
    });
});

// ============ DEVICE POLLING ============
app.post('/api/poll', (req, res) => {
    console.log('\n=== POLL REQUEST ===');
    console.log('Body:', req.body);
    
    const { deviceId, session } = req.body;
    
    if (!deviceId || !session) {
        console.log('Missing deviceId or session');
        return res.status(400).json({ error: 'Missing parameters' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        console.log(`Device not found: ${deviceId}`);
        return res.status(404).json({ error: 'Device not found' });
    }
    
    if (device.sessionId !== session) {
        console.log(`Invalid session for ${deviceId}`);
        console.log(`Expected: ${device.sessionId}, Received: ${session}`);
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    device.lastSeen = Date.now();
    
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        console.log(`Sending command to ${deviceId}: ${command.type}`);
        res.json(command);
    } else {
        console.log(`No commands for ${deviceId}`);
        res.status(204).end();
    }
});

// ============ DEVICE RESPONSE ============
app.post('/api/response', (req, res) => {
    console.log('\n=== RESPONSE RECEIVED ===');
    console.log('Full request body:', JSON.stringify(req.body));
    
    const { requestId, contentType, body } = req.body;
    
    if (!requestId) {
        console.log('ERROR: No requestId in response');
        return res.status(400).json({ 
            error: 'Missing requestId',
            receivedBody: req.body 
        });
    }
    
    console.log(`Request ID: ${requestId}`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Body length: ${body ? body.length : 0}`);
    
    if (body && body.length < 500) {
        console.log(`Body: ${body}`);
    } else if (body) {
        console.log(`Body preview: ${body ? body.substring(0, 200) : ''}...`);
    }
    
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        console.log(`ERROR: Request ${requestId} not found in pending requests`);
        console.log(`Available pending requests: ${Array.from(pendingRequests.keys())}`);
        return res.status(404).json({ 
            error: 'Request not found or expired',
            receivedRequestId: requestId,
            availableRequests: Array.from(pendingRequests.keys())
        });
    }
    
    console.log(`Found pending request for ${requestId}`);
    
    // Clean up
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    
    // Send response to client
    console.log(`Forwarding response to client...`);
    
    try {
        if (contentType) {
            pending.res.set('Content-Type', contentType);
        }
        pending.res.send(body);
        console.log(`Response forwarded successfully`);
        res.json({ status: 'ok', forwarded: true });
    } catch (error) {
        console.log(`Error forwarding response: ${error.message}`);
        res.status(500).json({ error: 'Failed to forward response' });
    }
});

// ============ DEVICE LIST API ============
app.get('/api/devices', (req, res) => {
    const deviceList = [];
    
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        const otaActive = otaSessions.has(deviceId) && otaSessions.get(deviceId).active;
        
        deviceList.push({
            deviceId: deviceId,
            ip: device.ip,
            lastSeen: device.lastSeen,
            online: isOnline,
            otaActive: otaActive,
            otaProgress: otaActive ? otaSessions.get(deviceId).progress : 0,
            sessionId: device.sessionId ? device.sessionId.substring(0, 20) + '...' : null
        });
    });
    
    res.json(deviceList);
});

// ============ OTA ENDPOINTS ============
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    console.log('File upload request');
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    otaSessions.set(deviceId, {
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        progress: 0,
        startTime: Date.now(),
        bytesSent: 0,
        active: false,
        firmwareData: null,
        chunkSize: 4096,
        currentOffset: 0,
        requestId: null
    });
    
    res.json({
        success: true,
        fileName: req.file.originalname,
        fileSize: req.file.size
    });
});

// ============ OTA CHUNK ENDPOINT ============
app.post('/api/ota/chunk', (req, res) => {
    const { deviceId, requestId, offset, size, data } = req.body;
    
    console.log(`OTA chunk received for ${deviceId}, offset: ${offset}, size: ${size}`);
    
    if (!deviceId || !requestId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const otaSession = otaSessions.get(deviceId);
    if (!otaSession) {
        return res.status(400).json({ error: 'No active OTA session' });
    }
    
    // Cihaza chunk gönder
    const command = {
        type: 'ota_chunk',
        requestId: requestId,
        offset: offset,
        size: size,
        data: data // base64 encoded
    };
    
    device.queue.push(command);
    
    // Progress güncelle
    otaSession.bytesSent += size;
    otaSession.progress = Math.round((otaSession.bytesSent / otaSession.fileSize) * 100);
    
    res.json({
        success: true,
        nextOffset: offset + size,
        bytesSent: otaSession.bytesSent,
        progress: otaSession.progress
    });
});

// ============ OTA FINALIZE ============
app.post('/api/ota/finalize', (req, res) => {
    const { deviceId, requestId } = req.body;
    
    if (!deviceId || !requestId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const otaSession = otaSessions.get(deviceId);
    if (!otaSession || !otaSession.active) {
        return res.status(400).json({ error: 'No active OTA session' });
    }
    
    const command = {
        type: 'ota_finalize',
        requestId: requestId
    };
    
    device.queue.push(command);
    
    // Cleanup
    otaSessions.delete(deviceId);
    
    res.json({ success: true });
});

// ============ ENHANCED OTA START ============
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    const otaSession = otaSessions.get(deviceId);
    if (!otaSession) {
        return res.status(400).json({ error: 'No firmware uploaded for this device' });
    }
    
    const requestId = 'ota_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    // Firmware dosyasını oku ve base64'e çevir
    try {
        const firmwareData = fs.readFileSync(otaSession.filePath);
        otaSession.firmwareData = firmwareData.toString('base64');
        otaSession.chunkSize = 1024; // 1KB chunks - ESP32 için daha güvenli
        otaSession.currentOffset = 0;
    } catch (error) {
        console.error('Failed to read firmware file:', error);
        return res.status(500).json({ error: 'Failed to read firmware file' });
    }
    
    const command = {
        type: 'ota_start',
        requestId: requestId,
        size: otaSession.fileSize,
        fileName: otaSession.fileName,
        chunkSize: otaSession.chunkSize
    };
    
    device.queue.push(command);
    
    // OTA session'ı güncelle
    otaSession.requestId = requestId;
    otaSession.progress = 0;
    otaSession.bytesSent = 0;
    otaSession.startTime = Date.now();
    otaSession.active = true;
    
    res.json({
        success: true,
        requestId: requestId,
        size: otaSession.fileSize,
        chunkSize: otaSession.chunkSize,
        totalChunks: Math.ceil(otaSession.fileSize / otaSession.chunkSize)
    });
});

app.get('/api/ota/status/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const otaSession = otaSessions.get(deviceId);
    
    if (!otaSession || !otaSession.active) {
        return res.json({
            active: false,
            progress: 0
        });
    }
    
    // Hız hesapla
    const elapsed = (Date.now() - otaSession.startTime) / 1000; // saniye
    const speed = elapsed > 0 ? otaSession.bytesSent / elapsed : 0;
    
    // Kalan süreyi hesapla
    const remainingBytes = otaSession.fileSize - otaSession.bytesSent;
    const eta = speed > 0 ? remainingBytes / speed : 0;
    
    res.json({
        active: true,
        progress: otaSession.progress,
        sent: otaSession.bytesSent,
        total: otaSession.fileSize,
        fileName: otaSession.fileName,
        speed: Math.round(speed),
        eta: Math.round(eta)
    });
});

app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    if (deviceId && otaSessions.has(deviceId)) {
        const session = otaSessions.get(deviceId);
        
        // Dosyayı sil
        if (session.filePath && fs.existsSync(session.filePath)) {
            fs.unlinkSync(session.filePath);
        }
        
        // Device'e cancel komutu gönder
        const device = devices.get(deviceId);
        if (device && session.requestId) {
            const command = {
                type: 'ota_cancel',
                requestId: session.requestId
            };
            device.queue.push(command);
        }
        
        // Session'ı temizle
        otaSessions.delete(deviceId);
    }
    
    res.json({ success: true });
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.url} not found`,
        availableEndpoints: [
            'GET /',
            'GET /device/:id',
            'GET /ota.html',
            'GET /health',
            'GET /api/devices',
            'GET /api/debug/pending',
            'GET /api/debug/devices',
            'POST /api/register',
            'POST /api/poll',
            'POST /api/response',
            'POST /api/upload',
            'POST /api/ota/start',
            'POST /api/ota/chunk',
            'POST /api/ota/finalize',
            'GET /api/ota/status/:id',
            'POST /api/ota/cancel'
        ]
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`SAT Web Connect Server Started`);
    console.log(`Port: ${PORT}`);
    console.log(`========================================\n`);
    
    // Create uploads directory
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
        console.log('Created uploads directory');
    }
    
    console.log('Available endpoints:');
    console.log('  GET  /                    - Main dashboard');
    console.log('  GET  /device/:id          - Access ESP32 device');
    console.log('  GET  /ota.html            - OTA dashboard');
    console.log('  GET  /health              - Health check');
    console.log('  GET  /api/devices         - List all devices');
    console.log('  GET  /api/debug/pending   - Debug pending requests');
    console.log('  GET  /api/debug/devices   - Debug devices');
    console.log('  POST /api/register        - Device registration');
    console.log('  POST /api/poll            - Device polling');
    console.log('  POST /api/response        - Response from device');
    console.log('  POST /api/upload          - Upload firmware');
    console.log('  POST /api/ota/start       - Start OTA');
    console.log('  POST /api/ota/chunk       - Send OTA chunk');
    console.log('  POST /api/ota/finalize    - Finalize OTA');
    console.log('  GET  /api/ota/status/:id  - OTA status');
    console.log('  POST /api/ota/cancel      - Cancel OTA');
});
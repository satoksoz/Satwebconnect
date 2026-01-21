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

// ============ TEST ENDPOINTS ============
app.get('/test/html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Page</title>
            <style>
                body { font-family: Arial; padding: 40px; text-align: center; }
                h1 { color: #4CAF50; }
            </style>
        </head>
        <body>
            <h1>✅ Server Test Page</h1>
            <p>If you see this, server is working correctly.</p>
            <p>Time: ${new Date().toISOString()}</p>
            <p>Devices online: ${devices.size}</p>
            <a href="/">Go to Dashboard</a>
        </body>
        </html>
    `);
});

app.get('/test/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`TEST Device access: ${deviceId}`);
    
    const device = devices.get(deviceId);
    
    if (!device) {
        return res.json({
            error: 'Device not found',
            availableDevices: Array.from(devices.keys()),
            timestamp: new Date().toISOString()
        });
    }
    
    res.json({
        deviceId: deviceId,
        online: (Date.now() - device.lastSeen) < 30000,
        lastSeen: device.lastSeen,
        lastSeenAgo: Date.now() - device.lastSeen,
        lastSeenDate: new Date(device.lastSeen).toISOString(),
        sessionId: device.sessionId,
        ip: device.ip,
        queueLength: device.queue.length,
        registeredAt: device.registeredAt,
        registeredAgo: Date.now() - device.registeredAt
    });
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
    console.log('Health check requested');
    res.json({
        status: 'ok',
        devices: devices.size,
        pendingRequests: pendingRequests.size,
        otaSessions: otaSessions.size,
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        uptime: process.uptime()
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
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                padding: 20px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: #333;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #1a237e 0%, #311b92 100%);
                color: white;
                padding: 25px;
                text-align: center;
            }
            .header h1 {
                font-size: 2.2em;
                margin-bottom: 10px;
            }
            .content {
                padding: 25px;
            }
            .device-card {
                background: #f8f9fa;
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0;
                box-shadow: 0 5px 15px rgba(0,0,0,0.08);
                border-left: 5px solid #4CAF50;
                transition: transform 0.3s;
            }
            .device-card:hover {
                transform: translateY(-5px);
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
                color: #1a237e;
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
            .btn-test { background: #ff9800; color: white; }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-bottom: 30px;
            }
            .stat-card {
                background: #f8f9fa;
                border-radius: 12px;
                padding: 20px;
                text-align: center;
                border-left: 4px solid #667eea;
            }
            .stat-number {
                font-size: 1.8em;
                font-weight: bold;
                color: #1a237e;
                margin: 10px 0;
            }
            @media (max-width: 768px) {
                .content {
                    padding: 15px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🌐 SAT Web Connect Dashboard</h1>
                <p>ESP32-S3 Remote Access & OTA Update System</p>
            </div>
            <div class="content">
                <div class="stats">
                    <div class="stat-card">
                        <i class="fas fa-microchip"></i>
                        <div class="stat-number">${devices.size}</div>
                        <div>Total Devices</div>
                    </div>
                    <div class="stat-card">
                        <i class="fas fa-wifi"></i>
                        <div class="stat-number" id="online-count">${onlineDevices}</div>
                        <div>Online</div>
                    </div>
                    <div class="stat-card">
                        <i class="fas fa-sync-alt"></i>
                        <div class="stat-number">${otaSessions.size}</div>
                        <div>OTA Active</div>
                    </div>
                </div>
                
                <div style="margin: 20px 0;">
                    <a href="/test/html" class="btn btn-test">Test Page</a>
                    <a href="/health" class="btn btn-primary">Health Check</a>
                    <a href="/api/debug/pending" class="btn btn-primary">Debug Pending</a>
                    <a href="/api/debug/devices" class="btn btn-primary">Debug Devices</a>
                </div>
    `;
    
    if (devices.size === 0) {
        html += `
                <div style="text-align: center; padding: 50px;">
                    <h2>No devices connected yet</h2>
                    <p>Waiting for ESP32 devices to register...</p>
                    <p>Check the serial monitor on your ESP32</p>
                </div>`;
    } else {
        devices.forEach((device, deviceId) => {
            const isOnline = (Date.now() - device.lastSeen) < 30000;
            if (isOnline) onlineDevices++;
            
            html += `
                <div class="device-card">
                    <div class="device-header">
                        <div class="device-id">${deviceId}</div>
                        <div class="status ${isOnline ? 'online' : 'offline'}">
                            ${isOnline ? '🟢 Online' : '🔴 Offline'}
                        </div>
                    </div>
                    <p><strong>IP:</strong> ${device.ip || 'N/A'}</p>
                    <p><strong>Last seen:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>
                    <p><strong>Session:</strong> ${device.sessionId.substring(0, 20)}...</p>
                    <div style="margin-top: 15px;">
                        <a href="/device/${deviceId}" class="btn btn-primary">Access Device</a>
                        <a href="/test/device/${deviceId}" class="btn btn-test" target="_blank">Test API</a>
                        ${isOnline ? `<a href="/ota.html?device=${deviceId}" class="btn btn-success">OTA Update</a>` : ''}
                    </div>
                </div>`;
        });
    }
    
    html += `
                <p style="margin-top: 30px; text-align: center;">
                    <strong>Online:</strong> ${onlineDevices} | 
                    <strong>Offline:</strong> ${devices.size - onlineDevices}
                </p>
                <script>
                    document.getElementById('online-count').textContent = ${onlineDevices};
                    // Auto-refresh every 10 seconds
                    setTimeout(() => location.reload(), 10000);
                </script>
            </div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/js/all.min.js"></script>
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
    console.log(`\n=== DEVICE ACCESS REQUESTED ===`);
    console.log(`Device: ${deviceId}`);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device) {
        console.log(`Device ${deviceId} not found in registry`);
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Device Not Found</title>
                <style>
                    body { font-family: Arial; padding: 50px; text-align: center; }
                    h1 { color: #f44336; }
                </style>
            </head>
            <body>
                <h1>❌ Device Not Found</h1>
                <p>Device <strong>${deviceId}</strong> is not registered.</p>
                <p>Available devices: ${Array.from(devices.keys()).join(', ')}</p>
                <a href="/">Go to Dashboard</a>
            </body>
            </html>
        `);
    }
    
    if (!isOnline) {
        console.log(`Device ${deviceId} is offline (last seen: ${new Date(device.lastSeen).toISOString()})`);
        return res.status(503).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Device Offline</title>
                <style>
                    body { font-family: Arial; padding: 50px; text-align: center; }
                    h1 { color: #ff9800; }
                </style>
            </head>
            <body>
                <h1>⚠️ Device Offline</h1>
                <p>Device <strong>${deviceId}</strong> is currently offline.</p>
                <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
                <p>Last seen ${Math.round((Date.now() - device.lastSeen) / 1000)} seconds ago</p>
                <a href="/">Go to Dashboard</a>
            </body>
            </html>
        `);
    }
    
    console.log(`Device ${deviceId} is online, creating request`);
    console.log(`Last seen: ${new Date(device.lastSeen).toISOString()}`);
    console.log(`Session: ${device.sessionId}`);
    
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
            console.log(`Request timeout: ${requestId} (30 seconds)`);
            res.status(504).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Timeout</title>
                    <style>
                        body { font-family: Arial; padding: 50px; text-align: center; }
                        h1 { color: #f44336; }
                    </style>
                </head>
                <body>
                    <h1>⏱️ Timeout</h1>
                    <p>Device <strong>${deviceId}</strong> didn't respond in 30 seconds.</p>
                    <p>The device might be busy or disconnected.</p>
                    <a href="/device/${deviceId}">Try Again</a> | 
                    <a href="/">Dashboard</a>
                </body>
                </html>
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
    
    console.log(`Request ${requestId} created, waiting for response from ESP32`);
    console.log(`Pending requests count: ${pendingRequests.size}`);
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
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { deviceId, ip, firmware, features, heap, mac } = req.body;
    
    if (!deviceId) {
        console.log('ERROR: No deviceId provided');
        return res.status(400).json({ 
            error: 'Invalid request',
            message: 'deviceId is required',
            received: req.body
        });
    }
    
    if (!deviceId.startsWith('Sat_')) {
        console.log('WARN: Device ID does not start with Sat_:', deviceId);
        // Bu sadece warning, devam edebiliriz
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip || req.ip,
        lastSeen: Date.now(),
        queue: [],
        registeredAt: Date.now(),
        firmware: firmware || 'unknown',
        features: features || 'unknown',
        heap: heap || 0,
        mac: mac || 'unknown'
    });
    
    console.log(`✅ Registered device: ${deviceId}`);
    console.log(`   Session: ${sessionId}`);
    console.log(`   IP: ${ip || req.ip}`);
    console.log(`   Firmware: ${firmware || 'unknown'}`);
    console.log(`   Total devices now: ${devices.size}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now(),
        serverUrl: req.protocol + '://' + req.get('host'),
        message: 'Device registered successfully'
    });
});

// ============ DEVICE POLLING ============
app.post('/api/poll', (req, res) => {
    console.log('\n=== POLL REQUEST ===');
    console.log('Device:', req.body.deviceId);
    console.log('Session:', req.body.session ? req.body.session.substring(0, 20) + '...' : 'none');
    console.log('OTA Active:', req.body.otaActive || false);
    
    const { deviceId, session } = req.body;
    
    if (!deviceId || !session) {
        console.log('ERROR: Missing deviceId or session');
        return res.status(400).json({ 
            error: 'Missing parameters',
            required: ['deviceId', 'session'],
            received: req.body
        });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        console.log(`ERROR: Device not found: ${deviceId}`);
        console.log(`Available devices: ${Array.from(devices.keys())}`);
        return res.status(404).json({ 
            error: 'Device not found',
            deviceId: deviceId,
            availableDevices: Array.from(devices.keys())
        });
    }
    
    if (device.sessionId !== session) {
        console.log(`ERROR: Invalid session for ${deviceId}`);
        console.log(`Expected: ${device.sessionId}`);
        console.log(`Received: ${session}`);
        return res.status(401).json({ 
            error: 'Invalid session',
            message: 'Session expired or invalid'
        });
    }
    
    device.lastSeen = Date.now();
    console.log(`✅ Device ${deviceId} is online`);
    console.log(`   Queue length: ${device.queue.length}`);
    
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        console.log(`📤 Sending command to ${deviceId}: ${command.type}`);
        console.log(`   Request ID: ${command.requestId}`);
        res.json(command);
    } else {
        console.log(`📭 No commands for ${deviceId}, sending 204`);
        res.status(204).end();
    }
});

// ============ DEVICE RESPONSE ============
app.post('/api/response', (req, res) => {
    console.log('\n=== RESPONSE RECEIVED ===');
    console.log('Headers:', req.headers);
    
    const { requestId, contentType, body } = req.body;
    
    if (!requestId) {
        console.log('ERROR: No requestId in response');
        console.log('Full body:', JSON.stringify(req.body, null, 2));
        return res.status(400).json({ 
            error: 'Missing requestId',
            receivedBody: req.body 
        });
    }
    
    console.log(`Request ID: ${requestId}`);
    console.log(`Content-Type: ${contentType || 'not specified'}`);
    console.log(`Body length: ${body ? body.length : 0} characters`);
    
    // Body içeriğini kontrol et
    if (body) {
        if (body.length < 500) {
            console.log(`Body preview:\n${body.substring(0, 300)}`);
        } else {
            console.log(`Body preview (first 300 chars):\n${body.substring(0, 300)}...`);
        }
        
        // HTML mi kontrol et
        if (body.includes('<!DOCTYPE') || body.includes('<html')) {
            console.log('✅ Body contains HTML document');
        }
    }
    
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        console.log(`ERROR: Request ${requestId} not found in pending requests`);
        console.log(`Currently pending: ${Array.from(pendingRequests.keys())}`);
        return res.status(404).json({ 
            error: 'Request not found or expired',
            receivedRequestId: requestId,
            pendingCount: pendingRequests.size,
            pendingRequests: Array.from(pendingRequests.keys())
        });
    }
    
    console.log(`✅ Found pending request for ${requestId}`);
    console.log(`   Device: ${pending.deviceId}`);
    console.log(`   Path: ${pending.path}`);
    console.log(`   Age: ${Date.now() - pending.createdAt}ms`);
    
    // Clean up
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    
    // Send response to client
    console.log(`📤 Forwarding response to client...`);
    
    try {
        // Set content type if provided
        if (contentType) {
            pending.res.set('Content-Type', contentType);
        } else {
            // Default to HTML if not specified
            pending.res.set('Content-Type', 'text/html; charset=utf-8');
        }
        
        // Set additional headers
        pending.res.set('X-Device-ID', pending.deviceId);
        pending.res.set('X-Request-ID', requestId);
        
        // Send the response
        pending.res.send(body);
        
        console.log(`✅ Response forwarded successfully`);
        console.log(`   Content-Type: ${contentType || 'text/html'}`);
        console.log(`   Body length sent: ${body ? body.length : 0} chars`);
        
        res.json({ 
            status: 'ok', 
            forwarded: true,
            requestId: requestId,
            deviceId: pending.deviceId
        });
        
    } catch (error) {
        console.log(`❌ Error forwarding response: ${error.message}`);
        console.log(error.stack);
        res.status(500).json({ 
            error: 'Failed to forward response',
            message: error.message
        });
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
            lastSeenFormatted: new Date(device.lastSeen).toISOString(),
            online: isOnline,
            otaActive: otaActive,
            otaProgress: otaActive ? otaSessions.get(deviceId).progress : 0,
            sessionId: device.sessionId ? device.sessionId.substring(0, 20) + '...' : null,
            firmware: device.firmware || 'unknown',
            features: device.features || 'unknown',
            heap: device.heap || 0,
            mac: device.mac || 'unknown',
            registeredAt: device.registeredAt,
            registeredAgo: Date.now() - device.registeredAt
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
        chunkSize: 1024, // 1KB chunks
        currentOffset: 0,
        requestId: null
    });
    
    res.json({
        success: true,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        message: 'Firmware uploaded successfully'
    });
});

// ============ OTA CHUNK ENDPOINT ============
app.post('/api/ota/chunk', (req, res) => {
    const { deviceId, requestId, offset, size, data } = req.body;
    
    console.log(`OTA chunk received for ${deviceId}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Offset: ${offset}, Size: ${size}`);
    console.log(`   Data length: ${data ? data.length : 0} chars`);
    
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
        total: otaSession.fileSize,
        progress: otaSession.progress,
        message: 'Chunk sent to device'
    });
});

// ============ OTA FINALIZE ============
app.post('/api/ota/finalize', (req, res) => {
    const { deviceId, requestId } = req.body;
    
    console.log(`OTA finalize for ${deviceId}, request: ${requestId}`);
    
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
    
    res.json({ 
        success: true,
        message: 'OTA finalized, device will restart'
    });
});

// ============ ENHANCED OTA START ============
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`OTA start requested for ${deviceId}`);
    
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
        otaSession.currentOffset = 0;
    } catch (error) {
        console.error('Failed to read firmware file:', error);
        return res.status(500).json({ 
            error: 'Failed to read firmware file',
            details: error.message 
        });
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
    
    console.log(`✅ OTA started for ${deviceId}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   File size: ${otaSession.fileSize} bytes`);
    console.log(`   Chunk size: ${otaSession.chunkSize} bytes`);
    
    res.json({
        success: true,
        requestId: requestId,
        size: otaSession.fileSize,
        chunkSize: otaSession.chunkSize,
        totalChunks: Math.ceil(otaSession.fileSize / otaSession.chunkSize),
        message: 'OTA started successfully'
    });
});

app.get('/api/ota/status/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const otaSession = otaSessions.get(deviceId);
    
    if (!otaSession || !otaSession.active) {
        return res.json({
            active: false,
            progress: 0,
            message: 'No active OTA session'
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
        eta: Math.round(eta),
        elapsed: Math.round(elapsed),
        requestId: otaSession.requestId
    });
});

app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`OTA cancel requested for ${deviceId}`);
    
    if (deviceId && otaSessions.has(deviceId)) {
        const session = otaSessions.get(deviceId);
        
        // Dosyayı sil
        if (session.filePath && fs.existsSync(session.filePath)) {
            fs.unlinkSync(session.filePath);
            console.log(`Deleted firmware file: ${session.filePath}`);
        }
        
        // Device'e cancel komutu gönder
        const device = devices.get(deviceId);
        if (device && session.requestId) {
            const command = {
                type: 'ota_cancel',
                requestId: session.requestId
            };
            device.queue.push(command);
            console.log(`Sent cancel command to device ${deviceId}`);
        }
        
        // Session'ı temizle
        otaSessions.delete(deviceId);
        console.log(`OTA session removed for ${deviceId}`);
    }
    
    res.json({ 
        success: true,
        message: 'OTA cancelled successfully'
    });
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
    console.error('\n❌ SERVER ERROR:', err.message);
    console.error('Stack:', err.stack);
    console.error('Request URL:', req.url);
    console.error('Request Method:', req.method);
    console.error('Request Body:', req.body);
    
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.url} not found`,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
            'GET  /                    - Main dashboard',
            'GET  /test/html           - Test page',
            'GET  /test/device/:id     - Test device API',
            'GET  /device/:id          - Access ESP32 device',
            'GET  /ota.html            - OTA dashboard',
            'GET  /health              - Health check',
            'GET  /api/devices         - List all devices',
            'GET  /api/debug/pending   - Debug pending requests',
            'GET  /api/debug/devices   - Debug devices',
            'POST /api/register        - Device registration',
            'POST /api/poll            - Device polling',
            'POST /api/response        - Response from device',
            'POST /api/upload          - Upload firmware',
            'POST /api/ota/start       - Start OTA',
            'POST /api/ota/chunk       - Send OTA chunk',
            'POST /api/ota/finalize    - Finalize OTA',
            'GET  /api/ota/status/:id  - OTA status',
            'POST /api/ota/cancel      - Cancel OTA'
        ]
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 SAT Web Connect Server Started`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🕐 ${new Date().toISOString()}`);
    console.log(`========================================\n`);
    
    // Create uploads directory
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
        console.log('📁 Created uploads directory');
    }
    
    console.log('✅ Available endpoints:');
    console.log('  GET  /                    - Main dashboard');
    console.log('  GET  /test/html           - Test page');
    console.log('  GET  /test/device/:id     - Test device API');
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
    console.log('\n🔍 Waiting for ESP32 devices to connect...\n');
});
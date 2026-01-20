const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' })); // Body boyutunu arttır
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from current directory
app.use(express.static(__dirname));

// Tüm request'leri logla
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n=== [${timestamp}] ${req.method} ${req.url} ===`);
    
    // Gelen IP'yi logla
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`📡 Client IP: ${clientIp}`);
    console.log(`📊 Headers:`, JSON.stringify(req.headers, null, 2).substring(0, 500));
    
    if (req.method === 'POST' && req.body) {
        console.log(`📦 Body received: ${JSON.stringify(req.body).length} characters`);
    }
    
    next();
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// File upload
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 }
});

// Storage
const devices = new Map();
const pendingRequests = new Map();
const otaSessions = new Map();

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        devices: devices.size,
        otaSessions: otaSessions.size,
        timestamp: new Date().toISOString()
    });
});

// Main dashboard
app.get('/', (req, res) => {
    console.log(`🏠 Main dashboard accessed`);
    
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
            .ota-active { border-left-color: #FF9800; }
            .btn {
                padding: 8px 16px;
                margin: 5px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
            }
            .btn-primary { background: #2196F3; color: white; }
            .btn-success { background: #4CAF50; color: white; }
        </style>
    </head>
    <body>
        <h1>📡 SAT Web Connect Dashboard</h1>
        <p>Total devices: ${devices.size}</p>
    `;
    
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        const otaActive = otaSessions.has(deviceId);
        
        if (isOnline) onlineDevices++;
        
        html += `
        <div class="device-card ${otaActive ? 'ota-active' : ''}">
            <div class="device-header">
                <div class="device-id">${deviceId}</div>
                <div class="status ${isOnline ? 'online' : 'offline'}">
                    ${isOnline ? '🟢 Online' : '🔴 Offline'}
                </div>
            </div>
            <p>IP: ${device.ip}</p>
            <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
            ${otaActive ? `<p>⚡ OTA in progress: ${otaSessions.get(deviceId).progress}%</p>` : ''}
            <div>
                <a href="/device/${deviceId}" class="btn btn-primary">Access Device</a>
                ${isOnline ? `<a href="/ota.html?device=${deviceId}" class="btn btn-success">OTA Update</a>` : ''}
            </div>
        </div>`;
    });
    
    html += `
        <p>Online: ${onlineDevices} | Offline: ${devices.size - onlineDevices}</p>
        <div style="margin-top: 30px;">
            <a href="/dashboard.html" class="btn btn-primary">Advanced Dashboard</a>
        </div>
        <script>
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// OTA Dashboard
app.get('/ota.html', (req, res) => {
    const deviceId = req.query.device;
    console.log(`📱 OTA dashboard requested for device: ${deviceId}`);
    
    if (!fs.existsSync('dashboard.html')) {
        console.log(`❌ dashboard.html not found!`);
        return res.status(404).send('Dashboard file not found');
    }
    
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Device access - root path
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`📱 Device access requested: ${deviceId}`);
    
    const device = devices.get(deviceId);
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        console.log(`❌ Device ${deviceId} is offline or not found`);
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Device Offline</h1>
                <p>The device ${deviceId} is currently offline or not connected.</p>
                <p>Last seen: ${device ? new Date(device.lastSeen).toLocaleString() : 'Never'}</p>
                <button onclick="window.history.back()">Go Back</button>
            </body></html>
        `);
    }
    
    console.log(`✅ Device ${deviceId} is online, last seen: ${new Date(device.lastSeen).toLocaleString()}`);
    
    // Create request ID
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'http_request',
        requestId: requestId,
        path: '/index.html',
        method: 'GET',
        timestamp: new Date().toISOString()
    };
    
    device.queue.push(command);
    console.log(`📤 Command added to queue for ${deviceId}: ${requestId}`);
    
    // Create pending request with timeout
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            console.log(`⏰ Request timeout: ${requestId}`);
            res.status(504).send(`
                <html><body style="text-align:center;padding:50px;">
                    <h1>Request Timeout</h1>
                    <p>The device ${deviceId} did not respond in time.</p>
                    <button onclick="location.reload()">Try Again</button>
                </body></html>
            `);
        }
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res,
        deviceId: deviceId,
        createdAt: Date.now()
    });
    
    console.log(`⏳ Waiting for response from device ${deviceId} (timeout: 30s)`);
});

// Device access - any path
app.get('/device/:deviceId/*', (req, res) => {
    const deviceId = req.params.deviceId;
    const requestedPath = req.params[0] || 'index.html';
    
    console.log(`📱 Device access requested: ${deviceId}/${requestedPath}`);
    
    const device = devices.get(deviceId);
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        console.log(`❌ Device ${deviceId} is offline or not found`);
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Device Offline</h1>
                <p>The device ${deviceId} is currently offline or not connected.</p>
                <p>Last seen: ${device ? new Date(device.lastSeen).toLocaleString() : 'Never'}</p>
                <button onclick="window.history.back()">Go Back</button>
            </body></html>
        `);
    }
    
    console.log(`✅ Device ${deviceId} is online`);
    
    // Create request ID
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'http_request',
        requestId: requestId,
        path: '/' + requestedPath,
        method: 'GET',
        timestamp: new Date().toISOString()
    };
    
    device.queue.push(command);
    console.log(`📤 Command added to queue for ${deviceId}: ${requestId} (path: ${command.path})`);
    
    // Create pending request with timeout
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            console.log(`⏰ Request timeout: ${requestId}`);
            res.status(504).send(`
                <html><body style="text-align:center;padding:50px;">
                    <h1>Request Timeout</h1>
                    <p>The device ${deviceId} did not respond in time.</p>
                    <button onclick="location.reload()">Try Again</button>
                </body></html>
            `);
        }
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res,
        deviceId: deviceId,
        path: requestedPath,
        createdAt: Date.now()
    });
    
    console.log(`⏳ Waiting for response from device ${deviceId} (timeout: 30s)`);
});

// Register
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    console.log(`📝 Registration attempt: ${deviceId} from ${ip}`);
    
    if (!deviceId?.startsWith('Sat_')) {
        console.log(`❌ Invalid device ID: ${deviceId}`);
        return res.status(400).json({ error: 'Invalid device ID' });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip,
        lastSeen: Date.now(),
        queue: []
    });
    
    console.log(`✅ Registered: ${deviceId} with session ${sessionId}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000
    });
});

// Poll
app.post('/api/poll', (req, res) => {
    const { deviceId, session, otaActive } = req.body;
    console.log(`📡 Poll from ${deviceId}, session: ${session}`);
    
    const device = devices.get(deviceId);
    if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return res.status(404).json({ error: 'Device not found' });
    }
    
    if (device.sessionId !== session) {
        console.log(`❌ Invalid session for ${deviceId}`);
        console.log(`   Expected: ${device.sessionId}`);
        console.log(`   Received: ${session}`);
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    device.lastSeen = Date.now();
    console.log(`✅ Device ${deviceId} is alive`);
    
    // Check queue
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        console.log(`📥 Sending command to ${deviceId}: ${command.type} (${command.requestId})`);
        res.json(command);
    } else {
        console.log(`📭 No commands for ${deviceId}`);
        res.status(204).end();
    }
});

// Response - BU ÇOK ÖNEMLİ!
app.post('/api/response', (req, res) => {
    const { requestId, contentType, body } = req.body;
    
    console.log(`\n📥 === RESPONSE RECEIVED ===`);
    console.log(`📨 Request ID: ${requestId}`);
    console.log(`📊 Content-Type: ${contentType}`);
    console.log(`📦 Body length: ${body ? body.length : 0}`);
    console.log(`📝 Body preview: ${body ? body.substring(0, 200) : 'No body'}`);
    
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        console.log(`❌ ERROR: Request not found in pending requests: ${requestId}`);
        console.log(`   Available pending requests: ${Array.from(pendingRequests.keys()).join(', ')}`);
        return res.status(404).json({ 
            error: 'Request not found',
            receivedRequestId: requestId,
            availableRequests: Array.from(pendingRequests.keys())
        });
    }
    
    console.log(`✅ Found pending request for ${requestId}`);
    
    // Clean up
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    
    // Send response to client
    console.log(`📤 Forwarding response to client`);
    res.set('Content-Type', contentType);
    res.send(body);
    
    console.log(`✅ Response forwarded successfully\n`);
});

// API endpoints for dashboard
app.get('/api/devices', (req, res) => {
    console.log(`📋 Devices list requested`);
    
    const deviceList = [];
    
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        const otaActive = otaSessions.has(deviceId);
        
        deviceList.push({
            deviceId: deviceId,
            ip: device.ip,
            lastSeen: device.lastSeen,
            online: isOnline,
            otaActive: otaActive,
            otaProgress: otaActive ? otaSessions.get(deviceId).progress : 0
        });
    });
    
    console.log(`📊 Returning ${deviceList.length} devices`);
    res.json(deviceList);
});

// File upload for OTA
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    console.log(`📁 File upload attempt`);
    
    if (!req.file) {
        console.log(`❌ No file uploaded`);
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { deviceId } = req.body;
    
    if (!deviceId) {
        console.log(`❌ No device ID provided`);
        return res.status(400).json({ error: 'Device ID required' });
    }
    
    const device = devices.get(deviceId);
    if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return res.status(404).json({ error: 'Device not found' });
    }
    
    // Store file info for OTA
    otaSessions.set(deviceId, {
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        progress: 0,
        startTime: Date.now(),
        bytesSent: 0
    });
    
    console.log(`✅ Firmware uploaded for ${deviceId}: ${req.file.originalname} (${req.file.size} bytes)`);
    
    res.json({
        success: true,
        fileName: req.file.originalname,
        fileSize: req.file.size
    });
});

// Start OTA
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    console.log(`🚀 OTA start requested for ${deviceId}`);
    
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
    
    // Create OTA start command
    const requestId = 'ota_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'ota_start',
        requestId: requestId,
        size: otaSession.fileSize,
        fileName: otaSession.fileName
    };
    
    device.queue.push(command);
    
    // Reset progress
    otaSession.progress = 0;
    otaSession.bytesSent = 0;
    
    console.log(`✅ OTA started for ${deviceId}, file: ${otaSession.fileName}`);
    
    res.json({
        success: true,
        requestId: requestId,
        size: otaSession.fileSize
    });
});

// OTA status
app.get('/api/ota/status/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const otaSession = otaSessions.get(deviceId);
    
    if (!otaSession) {
        return res.json({
            active: false,
            progress: 0
        });
    }
    
    // Calculate speed
    const elapsed = (Date.now() - otaSession.startTime) / 1000;
    const speed = elapsed > 0 ? otaSession.bytesSent / elapsed : 0;
    
    res.json({
        active: true,
        progress: otaSession.progress,
        sent: otaSession.bytesSent,
        total: otaSession.fileSize,
        speed: Math.round(speed),
        fileName: otaSession.fileName
    });
});

// Cancel OTA
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    if (deviceId && otaSessions.has(deviceId)) {
        const session = otaSessions.get(deviceId);
        
        // Clean up file
        if (session.filePath && fs.existsSync(session.filePath)) {
            fs.unlinkSync(session.filePath);
        }
        
        otaSessions.delete(deviceId);
        console.log(`❌ OTA cancelled for ${deviceId}`);
    }
    
    res.json({ success: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`💥 ERROR: ${err.message}`);
    console.error(err.stack);
    res.status(500).send('Internal Server Error');
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).send(`
        <html><body style="text-align:center;padding:50px;">
            <h1>404 Not Found</h1>
            <p>The requested URL ${req.url} was not found on this server.</p>
            <a href="/">Go to Dashboard</a>
        </body></html>
    `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 ========================================`);
    console.log(`🚀 SAT Web Connect Server Started`);
    console.log(`🚀 Port: ${PORT}`);
    console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🚀 ========================================\n`);
    
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
        console.log(`📁 Created uploads directory`);
    }
    
    // Check for required files
    const requiredFiles = ['dashboard.html', 'package.json'];
    requiredFiles.forEach(file => {
        if (fs.existsSync(file)) {
            console.log(`✅ ${file} found`);
        } else {
            console.log(`⚠️  ${file} not found`);
        }
    });
    
    console.log(`\n📱 Available endpoints:`);
    console.log(`   GET  /                    - Main dashboard`);
    console.log(`   GET  /device/:id          - Access ESP32 device`);
    console.log(`   GET  /ota.html            - OTA dashboard`);
    console.log(`   GET  /dashboard.html      - Advanced dashboard`);
    console.log(`   POST /api/register        - Device registration`);
    console.log(`   POST /api/poll            - Device polling`);
    console.log(`   POST /api/response        - Response from device`);
    console.log(`\n🔄 Server ready for connections...\n`);
});
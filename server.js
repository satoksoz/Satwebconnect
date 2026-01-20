const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Body parser - limit'i arttır
app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf.toString());
        } catch (e) {
            console.error('❌ Invalid JSON received:', e.message);
            res.status(400).json({ error: 'Invalid JSON' });
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Tüm request'leri logla
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n=== [${timestamp}] ${req.method} ${req.url} ===`);
    
    // Gelen IP'yi logla
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`📡 Client IP: ${clientIp}`);
    
    // User-Agent
    if (req.headers['user-agent']) {
        console.log(`👤 User-Agent: ${req.headers['user-agent'].substring(0, 100)}`);
    }
    
    // POST body'yi logla (küçük bir kısmını)
    if (req.method === 'POST' && req.body) {
        const bodyStr = JSON.stringify(req.body);
        console.log(`📦 Body size: ${bodyStr.length} chars`);
        if (bodyStr.length < 500) {
            console.log(`📋 Body: ${bodyStr}`);
        } else {
            console.log(`📋 Body preview: ${bodyStr.substring(0, 200)}...`);
        }
    }
    
    next();
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Preflight requests
    if (req.method === 'OPTIONS') {
        console.log('🔄 Preflight request');
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
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/octet-stream' || 
            file.originalname.endsWith('.bin')) {
            cb(null, true);
        } else {
            cb(new Error('Only .bin files are allowed'));
        }
    }
});

// Storage
const devices = new Map();
const pendingRequests = new Map();
const otaSessions = new Map();

// Health check
app.get('/health', (req, res) => {
    console.log('❤️  Health check requested');
    res.json({
        status: 'ok',
        devices: devices.size,
        pendingRequests: pendingRequests.size,
        otaSessions: otaSessions.size,
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

// Main dashboard
app.get('/', (req, res) => {
    console.log('🏠 Main dashboard accessed');
    
    let onlineDevices = 0;
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT Web Connect Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
                color: #333;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 2px solid #eee;
            }
            h1 { 
                color: #1a237e;
                margin-bottom: 10px;
                font-size: 2.5em;
            }
            .stats {
                display: flex;
                gap: 20px;
                margin: 20px 0;
                flex-wrap: wrap;
            }
            .stat-card {
                flex: 1;
                min-width: 200px;
                background: #f8f9fa;
                border-radius: 10px;
                padding: 20px;
                text-align: center;
                border-left: 4px solid #667eea;
            }
            .stat-card .number {
                font-size: 2em;
                font-weight: bold;
                color: #1a237e;
                margin: 10px 0;
            }
            .devices-container {
                margin-top: 30px;
            }
            .device-card {
                background: #f8f9fa;
                border-radius: 10px;
                padding: 20px;
                margin: 15px 0;
                border-left: 5px solid #4CAF50;
                transition: transform 0.3s;
            }
            .device-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.1);
            }
            .device-card.offline {
                border-left-color: #f44336;
                opacity: 0.7;
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
                padding: 10px 20px;
                margin: 5px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s;
            }
            .btn-primary { 
                background: #2196F3; 
                color: white; 
            }
            .btn-primary:hover { background: #1976D2; }
            .btn-success { 
                background: #4CAF50; 
                color: white; 
            }
            .btn-success:hover { background: #388E3C; }
            .btn:disabled {
                background: #ccc;
                cursor: not-allowed;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📡 SAT Web Connect Dashboard</h1>
                <p>Remote device management system for ESP32-S3</p>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="number">${devices.size}</div>
                    <div>Total Devices</div>
                </div>
                <div class="stat-card">
                    <div class="number">${Array.from(devices.values()).filter(d => (Date.now() - d.lastSeen) < 30000).length}</div>
                    <div>Online Now</div>
                </div>
                <div class="stat-card">
                    <div class="number">${otaSessions.size}</div>
                    <div>Active OTA</div>
                </div>
            </div>
            
            <div class="devices-container">
                <h2>Connected Devices</h2>
    `;
    
    if (devices.size === 0) {
        html += `
            <div style="text-align: center; padding: 40px; color: #666;">
                <h3>No devices connected yet</h3>
                <p>Waiting for ESP32 devices to register...</p>
            </div>
        `;
    } else {
        devices.forEach((device, deviceId) => {
            const isOnline = (Date.now() - device.lastSeen) < 30000;
            const otaActive = otaSessions.has(deviceId);
            
            if (isOnline) onlineDevices++;
            
            html += `
            <div class="device-card ${isOnline ? '' : 'offline'}">
                <div class="device-header">
                    <div class="device-id">${deviceId}</div>
                    <div class="status ${isOnline ? 'online' : 'offline'}">
                        ${isOnline ? '🟢 Online' : '🔴 Offline'}
                    </div>
                </div>
                <p><strong>IP:</strong> ${device.ip || 'N/A'}</p>
                <p><strong>Last seen:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>
                ${otaActive ? `<p><strong>OTA Progress:</strong> ${otaSessions.get(deviceId).progress}%</p>` : ''}
                <div style="margin-top: 15px;">
                    <a href="/device/${deviceId}" class="btn btn-primary">Access Device</a>
                    ${isOnline ? `<a href="/ota.html?device=${deviceId}" class="btn btn-success">OTA Update</a>` : 
                                 `<button class="btn btn-success" disabled>OTA Update</button>`}
                </div>
            </div>`;
        });
    }
    
    html += `
            </div>
            
            <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 10px;">
                <h3>Quick Links</h3>
                <div style="margin-top: 15px;">
                    <a href="/dashboard.html" class="btn btn-primary">Advanced Dashboard</a>
                    <a href="/health" class="btn btn-primary">Health Check</a>
                </div>
            </div>
            
            <script>
                // Auto refresh every 10 seconds
                setTimeout(() => {
                    location.reload();
                }, 10000);
                
                // Display connection status
                const connectionStatus = document.getElementById('connection-status');
                window.addEventListener('online', () => {
                    if (connectionStatus) connectionStatus.textContent = 'Online';
                });
                window.addEventListener('offline', () => {
                    if (connectionStatus) connectionStatus.textContent = 'Offline - Check your internet connection';
                });
            </script>
        </div>
    </body>
    </html>`;
    
    res.send(html);
});

// OTA Dashboard
app.get('/ota.html', (req, res) => {
    const deviceId = req.query.device;
    console.log(`📱 OTA dashboard requested for device: ${deviceId}`);
    
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    if (!fs.existsSync(dashboardPath)) {
        console.log(`❌ dashboard.html not found at ${dashboardPath}`);
        return res.status(404).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Dashboard Not Found</h1>
                <p>The dashboard.html file is missing from the server.</p>
                <a href="/">Go to Main Dashboard</a>
            </body></html>
        `);
    }
    
    console.log(`✅ Serving dashboard.html`);
    res.sendFile(dashboardPath);
});

// Device access - root path
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`📱 Device access requested: ${deviceId}`);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device || !isOnline) {
        console.log(`❌ Device ${deviceId} is offline or not found`);
        const lastSeen = device ? new Date(device.lastSeen).toLocaleString() : 'Never';
        return res.status(503).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Device Offline - ${deviceId}</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #f5f5f5; }
                    h1 { color: #f44336; }
                    .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                    button { padding: 10px 20px; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>⚠️ Device Offline</h1>
                    <p>The device <strong>${deviceId}</strong> is currently offline or not connected.</p>
                    <p><strong>Last seen:</strong> ${lastSeen}</p>
                    <p><strong>Status:</strong> ${device ? 'Registered but offline' : 'Not registered'}</p>
                    <div style="margin-top: 30px;">
                        <button onclick="window.history.back()">Go Back</button>
                        <button onclick="location.reload()">Try Again</button>
                        <button onclick="location.href='/'">Go to Dashboard</button>
                    </div>
                </div>
            </body>
            </html>
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
            console.log(`⏰ Request timeout: ${requestId} for device ${deviceId}`);
            res.status(504).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Request Timeout - ${deviceId}</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; background: #f5f5f5; }
                        h1 { color: #FF9800; }
                        .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                        button { padding: 10px 20px; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>⏰ Request Timeout</h1>
                        <p>The device <strong>${deviceId}</strong> did not respond in time (30 seconds).</p>
                        <p>This could mean:</p>
                        <ul style="text-align: left; max-width: 400px; margin: 20px auto;">
                            <li>Device is busy processing another request</li>
                            <li>Network connectivity issue</li>
                            <li>Device might have restarted</li>
                        </ul>
                        <div style="margin-top: 30px;">
                            <button onclick="location.reload()">Try Again</button>
                            <button onclick="location.href='/'">Go to Dashboard</button>
                        </div>
                    </div>
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
    
    console.log(`⏳ Waiting for response from device ${deviceId} (timeout: 30s)`);
    console.log(`📊 Pending requests: ${pendingRequests.size}`);
});

// Device access - any path
app.get('/device/:deviceId/*', (req, res) => {
    const deviceId = req.params.deviceId;
    const requestedPath = req.params[0] || 'index.html';
    
    console.log(`📱 Device access requested: ${deviceId}/${requestedPath}`);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device || !isOnline) {
        console.log(`❌ Device ${deviceId} is offline or not found`);
        return res.status(503).send(`Device ${deviceId} is offline`);
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
            console.log(`⏰ Request timeout: ${requestId} for device ${deviceId}`);
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
    
    console.log(`⏳ Waiting for response from device ${deviceId} (timeout: 30s)`);
});

// Register
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    console.log(`📝 Registration attempt: ${deviceId} from ${ip}`);
    
    if (!deviceId) {
        console.log(`❌ No device ID provided`);
        return res.status(400).json({ 
            error: 'Device ID is required',
            received: req.body 
        });
    }
    
    if (!deviceId.startsWith('Sat_')) {
        console.log(`❌ Invalid device ID format: ${deviceId}`);
        return res.status(400).json({ 
            error: 'Invalid device ID. Must start with "Sat_"',
            received: deviceId 
        });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    // Update or create device
    const existingDevice = devices.get(deviceId);
    if (existingDevice) {
        console.log(`🔄 Updating existing device: ${deviceId}`);
        existingDevice.sessionId = sessionId;
        existingDevice.ip = ip;
        existingDevice.lastSeen = Date.now();
    } else {
        devices.set(deviceId, {
            sessionId: sessionId,
            ip: ip,
            lastSeen: Date.now(),
            queue: [],
            registeredAt: Date.now()
        });
    }
    
    console.log(`✅ Registered/Updated: ${deviceId} with session ${sessionId}`);
    console.log(`📊 Total devices now: ${devices.size}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now(),
        deviceCount: devices.size
    });
});

// Poll
app.post('/api/poll', (req, res) => {
    const { deviceId, session, otaActive } = req.body;
    console.log(`📡 Poll from ${deviceId}, session: ${session ? session.substring(0, 20) + '...' : 'none'}`);
    
    const device = devices.get(deviceId);
    if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        console.log(`📋 Available devices: ${Array.from(devices.keys()).join(', ')}`);
        return res.status(404).json({ 
            error: 'Device not found. Please register first.',
            availableDevices: Array.from(devices.keys())
        });
    }
    
    if (!device.sessionId || device.sessionId !== session) {
        console.log(`❌ Invalid session for ${deviceId}`);
        console.log(`   Expected: ${device.sessionId}`);
        console.log(`   Received: ${session}`);
        return res.status(401).json({ 
            error: 'Invalid session. Please re-register.',
            expectedSession: device.sessionId,
            receivedSession: session
        });
    }
    
    device.lastSeen = Date.now();
    console.log(`✅ Device ${deviceId} is alive (last seen updated)`);
    
    // Check queue
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        console.log(`📥 Sending command to ${deviceId}: ${command.type} (${command.requestId})`);
        console.log(`   Path: ${command.path || 'N/A'}`);
        
        res.json(command);
    } else {
        console.log(`📭 No commands for ${deviceId}`);
        res.status(204).end();
    }
});

// Response - BU ÇOK ÖNEMLİ!
app.post('/api/response', (req, res) => {
    console.log(`\n📥 === RESPONSE RECEIVED FROM DEVICE ===`);
    
    const { requestId, contentType, body } = req.body;
    
    if (!requestId) {
        console.log(`❌ ERROR: No requestId in response`);
        console.log(`   Full body:`, JSON.stringify(req.body));
        return res.status(400).json({ 
            error: 'Missing requestId',
            received: req.body 
        });
    }
    
    console.log(`📨 Request ID: ${requestId}`);
    console.log(`📊 Content-Type: ${contentType || 'Not specified'}`);
    console.log(`📦 Body length: ${body ? body.length : 0} characters`);
    
    if (body && body.length < 500) {
        console.log(`📝 Body: ${body}`);
    } else if (body) {
        console.log(`📝 Body preview: ${body.substring(0, 200)}...`);
    }
    
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        console.log(`❌ ERROR: Request ID not found in pending requests: ${requestId}`);
        console.log(`   Available pending requests: ${Array.from(pendingRequests.keys()).join(', ')}`);
        console.log(`   Pending count: ${pendingRequests.size}`);
        
        // Pending request'leri listele
        pendingRequests.forEach((req, id) => {
            console.log(`   - ${id}: device=${req.deviceId}, age=${Date.now() - req.createdAt}ms`);
        });
        
        return res.status(404).json({ 
            error: 'Request not found or expired',
            receivedRequestId: requestId,
            availableRequests: Array.from(pendingRequests.keys()),
            pendingCount: pendingRequests.size
        });
    }
    
    console.log(`✅ Found pending request for ${requestId}`);
    console.log(`   Device: ${pending.deviceId}`);
    console.log(`   Path: ${pending.path || 'index.html'}`);
    console.log(`   Age: ${Date.now() - pending.createdAt}ms`);
    
    // Clean up
    pendingRequests.delete(requestId);
    if (pending.timeout) {
        clearTimeout(pending.timeout);
    }
    
    // Send response to client
    console.log(`📤 Forwarding response to client...`);
    
    try {
        if (contentType) {
            res.set('Content-Type', contentType);
        }
        
        res.send(body);
        console.log(`✅ Response forwarded successfully to client`);
    } catch (error) {
        console.log(`❌ Error forwarding response:`, error.message);
        res.status(500).json({ error: 'Failed to send response', details: error.message });
    }
    
    console.log(`📥 === RESPONSE PROCESSING COMPLETE ===\n`);
});

// API endpoints for dashboard
app.get('/api/devices', (req, res) => {
    console.log(`📋 Devices list API requested`);
    
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
            otaProgress: otaActive ? otaSessions.get(deviceId).progress : 0,
            sessionId: device.sessionId ? device.sessionId.substring(0, 20) + '...' : null,
            registeredAt: device.registeredAt || device.lastSeen
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
        bytesSent: 0,
        uploadedAt: Date.now()
    });
    
    console.log(`✅ Firmware uploaded for ${deviceId}:`);
    console.log(`   File: ${req.file.originalname}`);
    console.log(`   Size: ${req.file.size} bytes`);
    console.log(`   Path: ${req.file.path}`);
    
    res.json({
        success: true,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: Date.now()
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
        fileName: otaSession.fileName,
        timestamp: Date.now()
    };
    
    device.queue.push(command);
    
    // Reset progress
    otaSession.progress = 0;
    otaSession.bytesSent = 0;
    otaSession.startedAt = Date.now();
    
    console.log(`✅ OTA started for ${deviceId}:`);
    console.log(`   File: ${otaSession.fileName}`);
    console.log(`   Size: ${otaSession.fileSize} bytes`);
    console.log(`   Request ID: ${requestId}`);
    
    res.json({
        success: true,
        requestId: requestId,
        size: otaSession.fileSize,
        fileName: otaSession.fileName,
        startedAt: Date.now()
    });
});

// OTA status
app.get('/api/ota/status/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const otaSession = otaSessions.get(deviceId);
    
    if (!otaSession) {
        return res.json({
            active: false,
            progress: 0,
            message: 'No OTA session found'
        });
    }
    
    // Calculate speed
    const elapsed = (Date.now() - otaSession.startTime) / 1000;
    const speed = elapsed > 0 ? otaSession.bytesSent / elapsed : 0;
    const eta = speed > 0 ? (otaSession.fileSize - otaSession.bytesSent) / speed : 0;
    
    res.json({
        active: true,
        progress: otaSession.progress,
        sent: otaSession.bytesSent,
        total: otaSession.fileSize,
        speed: Math.round(speed),
        fileName: otaSession.fileName,
        elapsed: Math.round(elapsed),
        eta: Math.round(eta),
        startTime: otaSession.startTime
    });
});

// Cancel OTA
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    if (deviceId && otaSessions.has(deviceId)) {
        const session = otaSessions.get(deviceId);
        
        // Clean up file
        if (session.filePath && fs.existsSync(session.filePath)) {
            try {
                fs.unlinkSync(session.filePath);
                console.log(`🗑️  Deleted firmware file: ${session.filePath}`);
            } catch (err) {
                console.log(`⚠️  Could not delete file: ${err.message}`);
            }
        }
        
        otaSessions.delete(deviceId);
        console.log(`❌ OTA cancelled for ${deviceId}`);
    }
    
    res.json({ success: true, cancelled: !!deviceId });
});

// Static files
app.get('/dashboard.html', (req, res) => {
    console.log('📊 Advanced dashboard requested');
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`\n💥 === ERROR ===`);
    console.error(`Message: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    console.error(`URL: ${req.url}`);
    console.error(`Method: ${req.method}`);
    console.error(`Body:`, req.body);
    console.error(`💥 ==============\n`);
    
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
        timestamp: Date.now()
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        message: `The requested URL ${req.url} was not found on this server.`,
        timestamp: Date.now(),
        availableEndpoints: [
            'GET /',
            'GET /device/:id',
            'GET /ota.html',
            'GET /dashboard.html',
            'POST /api/register',
            'POST /api/poll',
            'POST /api/response',
            'GET /api/devices',
            'GET /health'
        ]
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 ========================================`);
    console.log(`🚀 SAT Web Connect Server Started`);
    console.log(`🚀 Port: ${PORT}`);
    console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🚀 PID: ${process.pid}`);
    console.log(`🚀 ========================================\n`);
    
    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log(`📁 Created uploads directory: ${uploadsDir}`);
    }
    
    // Check for required files
    const requiredFiles = ['dashboard.html', 'package.json'];
    requiredFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            console.log(`✅ ${file} found at ${filePath}`);
        } else {
            console.log(`⚠️  ${file} not found at ${filePath}`);
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
    console.log(`   GET  /api/devices         - List all devices`);
    console.log(`   GET  /health              - Health check`);
    console.log(`\n🔄 Server ready for connections at http://localhost:${PORT}\n`);
});
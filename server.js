const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
            }
            .btn-primary { background: #2196F3; color: white; }
            .btn-success { background: #4CAF50; color: white; }
        </style>
    </head>
    <body>
        <h1>SAT Web Connect Dashboard</h1>
        <p>Total devices: ${devices.size}</p>
    `;
    
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        const otaActive = otaSessions.has(deviceId);
        
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
    
    html += `
        <p>Online: ${onlineDevices} | Offline: ${devices.size - onlineDevices}</p>
        <script>
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// OTA Dashboard
app.get('/ota.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Device access
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    
    const device = devices.get(deviceId);
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Device Offline</h1>
                <p>The device ${deviceId} is currently offline.</p>
                <button onclick="window.history.back()">Go Back</button>
            </body></html>
        `);
    }
    
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
    
    // Create pending request
    const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        res.status(504).send('Request timeout');
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res
    });
});

// Device access - any path
app.get('/device/:deviceId/*', (req, res) => {
    const deviceId = req.params.deviceId;
    const path = req.params[0] || 'index.html';
    
    const device = devices.get(deviceId);
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        return res.status(503).send('Device offline');
    }
    
    // Add HTTP request to device queue
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    const command = {
        type: 'http_request',
        requestId: requestId,
        path: '/' + path,
        method: 'GET',
        timestamp: new Date().toISOString()
    };
    
    device.queue.push(command);
    
    // Create pending request
    const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        res.status(504).send('Request timeout');
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res
    });
});

// Register
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    
    if (!deviceId?.startsWith('Sat_')) {
        return res.status(400).json({ error: 'Invalid device ID' });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip,
        lastSeen: Date.now(),
        queue: []
    });
    
    console.log(`Registered: ${deviceId}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000
    });
});

// Poll
app.post('/api/poll', (req, res) => {
    const { deviceId, session, otaActive } = req.body;
    
    const device = devices.get(deviceId);
    if (!device || device.sessionId !== session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    device.lastSeen = Date.now();
    
    // Check queue
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        res.json(command);
    } else {
        res.status(204).end();
    }
});

// Response
app.post('/api/response', (req, res) => {
    const { requestId, contentType, body } = req.body;
    
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pendingRequests.delete(requestId);
        clearTimeout(pending.timeout);
        
        res.set('Content-Type', contentType);
        res.send(body);
    } else {
        res.status(404).json({ error: 'Request not found' });
    }
});

// API endpoints for dashboard
app.get('/api/devices', (req, res) => {
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
    
    res.json(deviceList);
});

// File upload for OTA
app.post('/api/upload', upload.single('firmware'), (req, res) => {
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
    
    // Store file info for OTA
    otaSessions.set(deviceId, {
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        progress: 0,
        startTime: Date.now(),
        bytesSent: 0
    });
    
    res.json({
        success: true,
        fileName: req.file.originalname,
        fileSize: req.file.size
    });
});

// Start OTA
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
    
    res.json({
        active: true,
        progress: otaSession.progress,
        sent: otaSession.bytesSent,
        total: otaSession.fileSize,
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
    }
    
    res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }
});
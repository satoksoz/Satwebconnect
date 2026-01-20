// server.js - SHORT POLLING
const express = require('express');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Device storage
const devices = new Map();
const pendingRequests = new Map();

// Cleanup interval
setInterval(() => {
    const now = Date.now();
    
    // Clean old devices (1 dakika)
    devices.forEach((device, deviceId) => {
        if (now - device.lastSeen > 60000) {
            devices.delete(deviceId);
            console.log(`🧹 Cleaned: ${deviceId}`);
        }
    });
    
    // Clean old pending requests (10 saniye)
    pendingRequests.forEach((request, requestId) => {
        if (now - request.timestamp > 10000) {
            pendingRequests.delete(requestId);
            console.log(`🧹 Cleaned request: ${requestId}`);
        }
    });
}, 30000);

// 1. REGISTER endpoint
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        return res.status(400).json({ error: 'Invalid device ID' });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip,
        lastSeen: Date.now(),
        commandQueue: []
    });
    
    console.log(`✅ Registered: ${deviceId}`);
    
    res.json({ 
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 5000 // 5 saniye
    });
});

// 2. SHORT POLL endpoint
app.post('/api/poll', (req, res) => {
    const { deviceId, session } = req.body;
    
    const device = devices.get(deviceId);
    
    // Validation
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    if (device.sessionId !== session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    // Update last seen
    device.lastSeen = Date.now();
    
    // Check for pending commands
    if (device.commandQueue.length > 0) {
        const command = device.commandQueue.shift();
        res.json(command);
    } else {
        // No commands - return 204 (No Content)
        res.status(204).end();
    }
});

// 3. RESPONSE endpoint
app.post('/api/response', (req, res) => {
    const { requestId, contentType, body } = req.body;
    
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pendingRequests.delete(requestId);
        
        res.set('Content-Type', contentType);
        res.send(body);
    } else {
        res.status(404).json({ error: 'Request not found' });
    }
});

// 4. DASHBOARD
app.get('/', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT Dashboard</title>
        <style>
            body { font-family: Arial; padding: 20px; }
            .device {
                border: 1px solid #ccc;
                padding: 15px;
                margin: 10px 0;
                border-radius: 5px;
                background: #f9f9f9;
            }
            .online { border-left: 5px solid green; }
            .offline { border-left: 5px solid red; }
        </style>
    </head>
    <body>
        <h1>📡 SAT Dashboard</h1>
        <p>Short Polling System</p>
    `;
    
    let onlineCount = 0;
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        if (isOnline) onlineCount++;
        
        html += `
        <div class="device ${isOnline ? 'online' : 'offline'}">
            <h3>${deviceId}</h3>
            <p>IP: ${device.ip}</p>
            <p>Status: ${isOnline ? '🟢 Online' : '🔴 Offline'}</p>
            <a href="/device/${deviceId}" target="_blank">Access Device</a>
        </div>`;
    });
    
    html += `<p>Online devices: ${onlineCount}</p>`;
    html += `
        <script>
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// 5. DEVICE ACCESS
app.get('/device/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const path = req.params[0] || 'index.html';
    
    const device = devices.get(deviceId);
    
    // Check if device is online (30 seconds)
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        return res.status(503).send(`
            <html>
            <body style="text-align:center;padding:50px;">
                <h1>🔴 Device Offline</h1>
                <p>${deviceId} is not connected</p>
                <a href="/">Back to Dashboard</a>
            </body>
            </html>
        `);
    }
    
    // Create request
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    
    // Add to device queue
    device.commandQueue.push({
        type: 'http_request',
        requestId: requestId,
        path: path
    });
    
    // Wait for response with timeout
    try {
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('Timeout'));
            }, 5000);
            
            pendingRequests.set(requestId, {
                res: res,
                timeout: timeout,
                timestamp: Date.now()
            });
        });
    } catch (error) {
        res.status(504).send(`
            <html>
            <body style="text-align:center;padding:50px;">
                <h1>⏱️ Timeout</h1>
                <p>Device did not respond in time</p>
                <a href="/">Back to Dashboard</a>
            </body>
            </html>
        `);
    }
});

app.get('/device/:deviceId', (req, res) => {
    res.redirect(`/device/${req.params.deviceId}/index.html`);
});

// 6. HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        devices: devices.size,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
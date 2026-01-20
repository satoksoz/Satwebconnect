const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Device storage
const devices = new Map();
const pendingRequests = new Map();
const otaSessions = new Map();

// Multer for file upload
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 }
});

// Register device
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        return res.status(400).json({ error: 'Invalid device ID' });
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        ip: ip,
        lastSeen: Date.now(),
        queue: []
    });
    
    console.log(`✅ Device registered: ${deviceId}`);
    res.json({ sessionId: sessionId, status: 'registered' });
});

// Device polling (Long Polling)
app.get('/api/poll', (req, res) => {
    const { deviceId, session } = req.query;
    
    const device = devices.get(deviceId);
    if (!device || device.sessionId !== session) {
        return res.status(404).json({ error: 'Session expired' });
    }
    
    device.lastSeen = Date.now();
    
    // Check if there are pending requests
    if (device.queue.length > 0) {
        const request = device.queue.shift();
        res.json(request);
    } else {
        // Long polling: wait for 8 seconds
        res.setTimeout(8000, () => {
            res.status(408).json({ status: 'timeout' });
        });
    }
});

// Handle device response
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

// Dashboard
app.get('/', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT HTTP Dashboard</title>
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
            .ota-active { background: #fff3e0; }
        </style>
    </head>
    <body>
        <h1>📡 SAT HTTP Streaming Dashboard</h1>
    `;
    
    let onlineCount = 0;
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000; // 30sn
        const otaActive = otaSessions.has(deviceId);
        
        if (isOnline) onlineCount++;
        
        html += `
        <div class="device ${isOnline ? 'online' : 'offline'} ${otaActive ? 'ota-active' : ''}">
            <h3>${deviceId}</h3>
            <p>IP: ${device.ip}</p>
            <p>Status: ${isOnline ? '🟢 Online' : '🔴 Offline'}</p>
            ${otaActive ? `<p>⚡ OTA in progress</p>` : ''}
            <a href="/device/${deviceId}" target="_blank">Access Device</a>
            <button onclick="startOTA('${deviceId}')">OTA Update</button>
        </div>`;
    });
    
    html += `<p>Total online: ${onlineCount}</p>`;
    html += `
        <script>
            function startOTA(deviceId) {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.bin';
                fileInput.onchange = (e) => {
                    const file = e.target.files[0];
                    uploadFirmware(deviceId, file);
                };
                fileInput.click();
            }
            
            async function uploadFirmware(deviceId, file) {
                const formData = new FormData();
                formData.append('firmware', file);
                formData.append('deviceId', deviceId);
                
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Firmware uploaded! Starting OTA...');
                    startOTAUpload(deviceId);
                }
            }
            
            async function startOTAUpload(deviceId) {
                const response = await fetch('/api/ota/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: deviceId })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('OTA started! Check device page for progress.');
                }
            }
            
            // Auto refresh
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// Device access
app.get('/device/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const filePath = req.params[0] || 'index.html';
    
    const device = devices.get(deviceId);
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
    
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Add request to device queue
    device.queue.push({
        type: 'http_request',
        requestId: requestId,
        path: filePath
    });
    
    // Wait for response
    try {
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('Timeout'));
            }, 10000);
            
            pendingRequests.set(requestId, {
                res: res,
                timeout: timeout,
                resolve: resolve
            });
        });
    } catch (error) {
        res.status(504).send(`
            <html>
            <body style="text-align:center;padding:50px;">
                <h1>⏱️ Device Timeout</h1>
                <p>${deviceId} did not respond</p>
                <a href="/">Back to Dashboard</a>
            </body>
            </html>
        `);
    }
});

app.get('/device/:deviceId', (req, res) => {
    res.redirect(`/device/${req.params.deviceId}/index.html`);
});

// File upload for OTA
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    const { deviceId } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file' });
    }
    
    const stats = fs.statSync(req.file.path);
    const fileSize = stats.size;
    
    otaSessions.set(deviceId, {
        filePath: req.file.path,
        fileSize: fileSize,
        uploaded: 0,
        progress: 0,
        chunkSize: 4096,
        startedAt: Date.now()
    });
    
    res.json({
        success: true,
        filename: req.file.originalname,
        size: fileSize
    });
});

// Start OTA
app.post('/api/ota/start', async (req, res) => {
    const { deviceId } = req.body;
    
    const device = devices.get(deviceId);
    const session = otaSessions.get(deviceId);
    
    if (!device || !session) {
        return res.status(404).json({ error: 'Device or OTA session not found' });
    }
    
    // Send OTA start command
    const requestId = 'ota_start_' + Date.now();
    device.queue.push({
        type: 'ota_start',
        requestId: requestId,
        size: session.fileSize
    });
    
    res.json({ success: true, message: 'OTA started' });
});

// Cleanup
setInterval(() => {
    const now = Date.now();
    
    // Clean old devices
    devices.forEach((device, deviceId) => {
        if (now - device.lastSeen > 120000) { // 2 minutes
            devices.delete(deviceId);
            console.log(`🧹 Cleaned device: ${deviceId}`);
        }
    });
    
    // Clean old OTA sessions
    otaSessions.forEach((session, deviceId) => {
        if (now - session.startedAt > 300000) { // 5 minutes
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
            otaSessions.delete(deviceId);
            console.log(`🧹 Cleaned OTA session: ${deviceId}`);
        }
    });
}, 30000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 HTTP Streaming Server on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
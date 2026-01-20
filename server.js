const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Dashboard
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
                <a href="/device/${deviceId}" target="_blank" class="btn btn-primary">Access Device</a>
                ${isOnline ? `<button onclick="startOTA('${deviceId}')" class="btn btn-success">OTA Update</button>` : ''}
            </div>
        </div>`;
    });
    
    html += `
        <p>Online: ${onlineDevices} | Offline: ${devices.size - onlineDevices}</p>
        <script>
            function startOTA(deviceId) {
                window.open('/ota.html?device=' + deviceId, '_blank');
            }
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
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
    
    console.log(`✅ Registered: ${deviceId}`);
    
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

// Device access
app.get('/device/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const path = req.params[0] || 'index.html';
    
    const device = devices.get(deviceId);
    if (!device || (Date.now() - device.lastSeen) > 30000) {
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>
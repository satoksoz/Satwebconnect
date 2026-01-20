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
        timestamp: new Date().toISOString()
    });
});

// DEBUG ENDPOINT - Pending requests
app.get('/api/debug/pending', (req, res) => {
    console.log('🐛 Debug pending requests requested');
    
    const pendingList = [];
    
    pendingRequests.forEach((pending, requestId) => {
        pendingList.push({
            requestId: requestId,
            deviceId: pending.deviceId,
            age: Date.now() - pending.createdAt,
            path: pending.path || '/index.html',
            hasTimeout: !!pending.timeout,
            createdAt: new Date(pending.createdAt).toISOString()
        });
    });
    
    res.json({
        timestamp: new Date().toISOString(),
        pendingCount: pendingRequests.size,
        pendingRequests: pendingList,
        devicesCount: devices.size,
        devices: Array.from(devices.keys()),
        onlineDevices: Array.from(devices.entries())
            .filter(([id, device]) => (Date.now() - device.lastSeen) < 30000)
            .map(([id]) => id)
    });
});

// DEBUG ENDPOINT - Direct test response
app.get('/api/test/response', (req, res) => {
    console.log('🧪 Test response endpoint called');
    
    const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Direct Server Test</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                max-width: 600px;
                text-align: center;
            }
            h1 { 
                color: #4CAF50;
                margin-bottom: 20px;
                font-size: 2.5em;
            }
            p {
                color: #666;
                margin: 10px 0;
                line-height: 1.6;
            }
            .success {
                color: #4CAF50;
                font-weight: bold;
                font-size: 1.2em;
                margin: 20px 0;
            }
            .info {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>✅ Direct Server Test</h1>
            <p class="success">If you can see this, the server is working correctly!</p>
            
            <div class="info">
                <p><strong>Endpoint:</strong> /api/test/response</p>
                <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                <p><strong>Server:</strong> satwebconnect.onrender.com</p>
                <p><strong>Status:</strong> Direct HTML response from server</p>
            </div>
            
            <p>This page is served <strong>directly from the server</strong>, not from ESP32.</p>
            <p>If this works but /device/Sat_af453ab4 doesn't work, there's an issue with the ESP32 communication.</p>
            
            <div style="margin-top: 30px;">
                <a href="/" style="padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 5px;">
                    Go to Dashboard
                </a>
                <a href="/device/Sat_af453ab4" style="padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 5px;">
                    Test ESP32 Device
                </a>
            </div>
        </div>
    </body>
    </html>`;
    
    res.set('Content-Type', 'text/html');
    res.send(testHtml);
});

// DEBUG ENDPOINT - Simulate ESP32 response
app.get('/api/debug/simulate-response', (req, res) => {
    console.log('🔄 Simulating ESP32 response');
    
    // Rastgele bir request ID oluştur
    const requestId = 'debug_req_' + Date.now();
    
    // Bu request'i pending'e ekle
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
        }
    }, 30000);
    
    pendingRequests.set(requestId, {
        timeout: timeout,
        res: res,
        deviceId: 'DEBUG_DEVICE',
        createdAt: Date.now(),
        path: '/debug'
    });
    
    console.log(`📝 Created debug pending request: ${requestId}`);
    
    // 2 saniye sonra otomatik response gönder
    setTimeout(() => {
        console.log(`📤 Sending automatic response for ${requestId}`);
        
        const debugHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Debug Response</title></head>
        <body>
            <h1>🧪 Debug Simulation</h1>
            <p>This is a simulated response from "ESP32"</p>
            <p>Request ID: ${requestId}</p>
            <p>Time: ${new Date().toISOString()}</p>
        </body>
        </html>`;
        
        // Response endpoint'ini çağır
        fetch(`http://localhost:${process.env.PORT || 3000}/api/response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId: requestId,
                contentType: 'text/html',
                body: debugHtml
            })
        }).then(response => response.text())
          .then(data => {
              console.log('Debug response sent:', data);
          })
          .catch(err => {
              console.error('Debug response error:', err);
          });
    }, 2000);
    
    res.json({
        message: 'Debug simulation started',
        requestId: requestId,
        checkUrl: `/device/DEBUG_DEVICE?debug=${requestId}`
    });
});

// Main dashboard
app.get('/', (req, res) => {
    console.log('🏠 Main dashboard accessed');
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT Dashboard</title>
        <style>
            body { font-family: Arial; padding: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { color: #333; }
            .device-card {
                background: white;
                border-radius: 10px;
                padding: 20px;
                margin: 15px 0;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .btn {
                padding: 10px 20px;
                margin: 5px;
                background: #2196F3;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📡 SAT Web Connect</h1>
            <p>Connected devices: ${devices.size}</p>
            <div>
                <a href="/device/Sat_af453ab4" class="btn">Access ESP32</a>
                <a href="/api/test/response" class="btn">Test Server</a>
                <a href="/api/debug/pending" class="btn">Debug Pending</a>
                <a href="/health" class="btn">Health Check</a>
            </div>
    `;
    
    if (devices.size > 0) {
        html += `<h2>Connected Devices:</h2>`;
        devices.forEach((device, deviceId) => {
            const isOnline = (Date.now() - device.lastSeen) < 30000;
            html += `
            <div class="device-card">
                <h3>${deviceId} ${isOnline ? '🟢' : '🔴'}</h3>
                <p>IP: ${device.ip || 'N/A'}</p>
                <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
                <a href="/device/${deviceId}" class="btn">Access</a>
            </div>`;
        });
    }
    
    html += `
        </div>
        <script>
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// Device access - root path
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`📱 Device access requested: ${deviceId}`);
    
    // DEBUG: Tüm parametreleri logla
    console.log(`🔍 Query params:`, req.query);
    console.log(`🔍 Headers:`, req.headers);
    
    const device = devices.get(deviceId);
    const isOnline = device && (Date.now() - device.lastSeen) < 30000;
    
    if (!device || !isOnline) {
        console.log(`❌ Device ${deviceId} is offline or not found`);
        return res.status(503).send(`
            <html><body style="text-align:center;padding:50px;">
                <h1>Device Offline</h1>
                <p>Device ${deviceId} is offline.</p>
                <a href="/">Go to Dashboard</a>
            </body></html>
        `);
    }
    
    console.log(`✅ Device ${deviceId} is online`);
    
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
    console.log(`📊 Device queue length: ${device.queue.length}`);
    
    // ÖNEMLİ: Pending request'i kaydet
    const timeout = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            console.log(`⏰ Request timeout: ${requestId} for device ${deviceId}`);
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
    
    console.log(`⏳ Waiting for response (${requestId})`);
    console.log(`📋 Pending requests count: ${pendingRequests.size}`);
    console.log(`📋 All pending IDs: ${Array.from(pendingRequests.keys()).join(', ')}`);
});

// Device access - any path
app.get('/device/:deviceId/*', (req, res) => {
    const deviceId = req.params.deviceId;
    const requestedPath = req.params[0] || 'index.html';
    
    console.log(`📱 Device access: ${deviceId}/${requestedPath}`);
    
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
            res.status(504).send('Timeout');
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

// Register
app.post('/api/register', (req, res) => {
    const { deviceId, ip } = req.body;
    console.log(`📝 Registration: ${deviceId} from ${ip}`);
    
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
    console.log(`📡 Poll from ${deviceId}`);
    
    const device = devices.get(deviceId);
    if (!device || device.sessionId !== session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    device.lastSeen = Date.now();
    
    if (device.queue.length > 0) {
        const command = device.queue.shift();
        console.log(`📥 Sending command to ${deviceId}: ${command.type} (${command.requestId})`);
        res.json(command);
    } else {
        console.log(`📭 No commands for ${deviceId}`);
        res.status(204).end();
    }
});

// Response - EN ÖNEMLİ KISIM
app.post('/api/response', (req, res) => {
    console.log(`\n📥 === RESPONSE RECEIVED ===`);
    
    const { requestId, contentType, body } = req.body;
    
    if (!requestId) {
        console.log(`❌ ERROR: No requestId`);
        return res.status(400).json({ error: 'Missing requestId' });
    }
    
    console.log(`📨 Request ID: ${requestId}`);
    console.log(`📊 Content-Type: ${contentType}`);
    console.log(`📦 Body length: ${body?.length || 0}`);
    
    // Tüm pending request'leri listele
    console.log(`📋 All pending requests: ${Array.from(pendingRequests.keys()).join(', ')}`);
    
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        console.log(`❌ ERROR: Request ${requestId} not found in pending!`);
        console.log(`   Available: ${Array.from(pendingRequests.keys()).join(', ')}`);
        return res.status(404).json({ 
            error: 'Request not found',
            receivedId: requestId,
            availableIds: Array.from(pendingRequests.keys())
        });
    }
    
    console.log(`✅ Found pending request for ${requestId}`);
    console.log(`   Device: ${pending.deviceId}`);
    console.log(`   Age: ${Date.now() - pending.createdAt}ms`);
    
    // Clean up
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    
    // Send to client
    console.log(`📤 Forwarding to client...`);
    
    try {
        if (contentType) {
            pending.res.set('Content-Type', contentType);
        }
        pending.res.send(body);
        console.log(`✅ Successfully forwarded response`);
    } catch (error) {
        console.log(`❌ Error forwarding:`, error.message);
        res.status(500).json({ error: 'Forwarding failed' });
        return;
    }
    
    res.json({ status: 'ok', forwarded: true });
});

// API endpoints
app.get('/api/devices', (req, res) => {
    const deviceList = [];
    
    devices.forEach((device, deviceId) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        deviceList.push({
            deviceId: deviceId,
            ip: device.ip,
            lastSeen: device.lastSeen,
            online: isOnline
        });
    });
    
    res.json(deviceList);
});

// OTA endpoints (basit versiyon)
app.post('/api/upload', upload.single('firmware'), (req, res) => {
    res.json({ success: true });
});

app.post('/api/ota/start', (req, res) => {
    res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server started on port ${PORT}`);
    console.log(`📱 Test endpoints:`);
    console.log(`   http://localhost:${PORT}/api/test/response`);
    console.log(`   http://localhost:${PORT}/api/debug/pending`);
    console.log(`   http://localhost:${PORT}/device/Sat_af453ab4`);
    console.log(`   http://localhost:${PORT}/health`);
});
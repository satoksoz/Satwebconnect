const express = require('express');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - ESP32 için gerekli
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Health check - RENDER ZORUNLU
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        devices: Object.keys(devices).length,
        timestamp: new Date().toISOString(),
        message: 'SAT Web Connect - Render.com'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>SAT Web Connect</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 40px;
                text-align: center;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
            }
            .card {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            }
            h1 {
                font-size: 2.5em;
                margin-bottom: 20px;
            }
            .status {
                display: inline-block;
                padding: 10px 20px;
                background: rgba(76, 175, 80, 0.3);
                border-radius: 20px;
                margin: 20px 0;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🚀 SAT Web Connect</h1>
            <div class="status">🟢 Server Running</div>
            <p>ESP32 Reverse Tunnel System on Render.com</p>
            <p>Connected devices: ${Object.keys(devices).length}</p>
            <div style="margin-top: 30px;">
                <a href="/health" style="color: white; text-decoration: underline;">Health Check</a> |
                <a href="/api/devices" style="color: white; text-decoration: underline;">Devices API</a>
            </div>
        </div>
    </body>
    </html>
    `);
});

// Device storage
const devices = {};

// 1. Register endpoint
app.post('/api/register', (req, res) => {
    console.log('📝 Register request:', req.body);
    
    const { deviceId, ip, timestamp } = req.body;
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        return res.status(400).json({ 
            error: 'Invalid device ID',
            expected: 'Sat_XXXXX format'
        });
    }
    
    const sessionId = 'render_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    devices[deviceId] = {
        sessionId: sessionId,
        ip: ip,
        lastSeen: Date.now(),
        registeredAt: new Date().toISOString(),
        timestamp: timestamp || Date.now()
    };
    
    console.log(`✅ Device registered: ${deviceId}`);
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        message: `Device ${deviceId} registered successfully`,
        serverTime: new Date().toISOString(),
        pollEndpoint: '/api/poll',
        pollInterval: 10000
    });
});

// 2. Poll endpoint
app.post('/api/poll', (req, res) => {
    const { deviceId, session, timestamp } = req.body;
    
    console.log(`📡 Poll request from: ${deviceId}`);
    
    const device = devices[deviceId];
    
    if (!device) {
        return res.status(404).json({ 
            error: 'Device not found',
            suggestion: 'Register first at /api/register'
        });
    }
    
    if (device.sessionId !== session) {
        return res.status(401).json({ 
            error: 'Invalid session',
            suggestion: 'Re-register device'
        });
    }
    
    // Update last seen
    device.lastSeen = Date.now();
    
    // Test için basit bir komut gönder (ilk poll'da)
    if (!device.hasReceivedCommand) {
        device.hasReceivedCommand = true;
        
        res.json({
            type: 'http_request',
            requestId: 'test_' + Date.now(),
            path: '/index.html',
            method: 'GET',
            timestamp: new Date().toISOString()
        });
    } else {
        // No commands available
        res.status(204).end();
    }
});

// 3. Response endpoint
app.post('/api/response', (req, res) => {
    console.log('📤 Response received:', req.body.requestId);
    
    const { requestId, contentType, body } = req.body;
    
    res.json({
        status: 'received',
        requestId: requestId,
        receivedAt: new Date().toISOString(),
        note: 'Response stored successfully'
    });
});

// 4. Devices list
app.get('/api/devices', (req, res) => {
    const deviceList = Object.keys(devices).map(deviceId => {
        const device = devices[deviceId];
        return {
            deviceId: deviceId,
            ip: device.ip,
            lastSeen: device.lastSeen,
            registeredAt: device.registeredAt,
            isOnline: (Date.now() - device.lastSeen) < 30000
        };
    });
    
    res.json({
        count: deviceList.length,
        devices: deviceList,
        timestamp: new Date().toISOString()
    });
});

// 5. Cleanup old devices (her 5 dakikada)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    Object.keys(devices).forEach(deviceId => {
        if (now - devices[deviceId].lastSeen > 300000) { // 5 dakika
            delete devices[deviceId];
            cleaned++;
            console.log(`🧹 Cleaned device: ${deviceId}`);
        }
    });
    
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} inactive devices`);
    }
}, 300000);

// 6. 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET  /',
            'GET  /health',
            'POST /api/register',
            'POST /api/poll',
            'POST /api/response',
            'GET  /api/devices'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SAT Server running on port ${PORT}`);
    console.log(`📊 Dashboard: https://satwebconnect.onrender.com`);
    console.log(`🔧 Health: https://satwebconnect.onrender.com/health`);
    console.log(`📱 Register: POST https://satwebconnect.onrender.com/api/register`);
});
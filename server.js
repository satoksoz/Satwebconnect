// server.js'de /api/register endpoint'ini güncelleyin:

app.post('/api/register', (req, res) => {
    console.log('\n=== REGISTER REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { 
        deviceId, 
        model, 
        ip, 
        mac, 
        location, 
        purpose, 
        firmware, 
        features, 
        heap, 
        flash,
        chipId,
        chipRevision,
        sdkVersion 
    } = req.body;
    
    if (!deviceId) {
        console.log('ERROR: No deviceId provided');
        return res.status(400).json({ 
            error: 'Invalid request',
            message: 'deviceId is required',
            received: req.body
        });
    }
    
    // Device ID format kontrolü
    if (!deviceId.startsWith('Sat_')) {
        console.log('WARN: Device ID does not start with Sat_:', deviceId);
        // Yine de kaydedebiliriz, sadece warning
    }
    
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    // Mevcut device varsa güncelle, yoksa yeni oluştur
    const existingDevice = devices.get(deviceId);
    
    devices.set(deviceId, {
        sessionId: sessionId,
        model: model || 'ESP32-S3',
        ip: ip || req.ip,
        mac: mac || 'unknown',
        location: location || 'Unknown',
        purpose: purpose || 'General',
        lastSeen: Date.now(),
        queue: existingDevice ? existingDevice.queue : [],
        registeredAt: existingDevice ? existingDevice.registeredAt : Date.now(),
        firmware: firmware || 'unknown',
        features: features || 'unknown',
        heap: heap || 0,
        flash: flash || 0,
        chipId: chipId || 'unknown',
        chipRevision: chipRevision || 0,
        sdkVersion: sdkVersion || 'unknown',
        otaActive: false,
        otaProgress: 0
    });
    
    console.log(`✅ Registered/Updated device: ${deviceId}`);
    console.log(`   Model: ${model || 'ESP32-S3'}`);
    console.log(`   Location: ${location || 'Unknown'}`);
    console.log(`   Purpose: ${purpose || 'General'}`);
    console.log(`   Session: ${sessionId}`);
    console.log(`   Total devices now: ${devices.size}`);
    
    // Tüm cihazları listele
    console.log('📋 All registered devices:');
    devices.forEach((device, id) => {
        const isOnline = (Date.now() - device.lastSeen) < 30000;
        console.log(`   ${id} - ${isOnline ? '🟢' : '🔴'} ${device.location} (${device.model})`);
    });
    
    res.json({
        sessionId: sessionId,
        status: 'registered',
        pollInterval: 10000,
        serverTime: Date.now(),
        serverUrl: req.protocol + '://' + req.get('host'),
        message: 'Device registered successfully',
        totalDevices: devices.size
    });
});
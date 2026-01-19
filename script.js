class Dashboard {
    constructor() {
        this.ws = null;
        this.devices = [];
        this.logEntries = [];
        this.init();
    }

    init() {
        this.connectWebSocket();
        this.loadDevices();
        this.setupEventListeners();
        this.addLog('Dashboard başlatıldı', 'info');
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.addLog('Sunucuya bağlanıldı', 'success');
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('Mesaj hatası:', error);
            }
        };
        
        this.ws.onerror = (error) => {
            this.addLog('Bağlantı hatası', 'error');
            console.error('WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            this.addLog('Bağlantı kesildi. 3 saniye sonra yeniden bağlanılıyor...', 'warning');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }

    handleWebSocketMessage(data) {
        switch(data.type) {
            case 'device_list':
                this.updateDevices(data.devices);
                break;
                
            case 'device_response':
                this.addLog(`${data.device_id}: ${data.message}`, data.success ? 'success' : 'error');
                break;
                
            case 'registration_confirmed':
                this.addLog(data.message, 'success');
                break;
        }
    }

    loadDevices() {
        fetch('/api/devices')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.updateDevices(data.devices);
                }
            })
            .catch(error => {
                console.error('Cihaz yükleme hatası:', error);
                this.addLog('Cihazlar yüklenemedi', 'error');
            });
    }

    updateDevices(devices) {
        this.devices = devices;
        this.updateStats();
        this.renderDevices();
    }

    updateStats() {
        const total = this.devices.length;
        const online = this.devices.filter(d => d.status === 'online').length;
        const offline = total - online;
        
        document.getElementById('totalDevices').textContent = total;
        document.getElementById('onlineDevices').textContent = online;
        document.getElementById('offlineDevices').textContent = offline;
    }

    renderDevices() {
        const container = document.getElementById('devicesContainer');
        const noDevicesMsg = document.getElementById('noDevicesMessage');
        
        if (this.devices.length === 0) {
            noDevicesMsg.style.display = 'block';
            container.innerHTML = '';
            container.appendChild(noDevicesMsg);
            return;
        }
        
        noDevicesMsg.style.display = 'none';
        
        container.innerHTML = this.devices.map(device => `
            <div class="device-card">
                <div class="device-header">
                    <div class="device-name">${device.device_name}</div>
                    <div class="device-status ${device.status === 'online' ? 'status-online' : 'status-offline'}">
                        ${device.status === 'online' ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                    </div>
                </div>
                <div class="device-info">
                    <p><strong>ID:</strong> ${device.device_id}</p>
                    <p><strong>IP:</strong> ${device.local_ip}</p>
                    <p><strong>Son Görülme:</strong> ${new Date(device.last_seen).toLocaleTimeString()}</p>
                </div>
                <div class="device-controls">
                    <button class="control-btn" style="background:#28a745;color:white" 
                            onclick="dashboard.sendCommand('${device.device_id}', 'LED_ON')">
                        <i class="fas fa-lightbulb"></i> LED Aç
                    </button>
                    <button class="control-btn" style="background:#dc3545;color:white" 
                            onclick="dashboard.sendCommand('${device.device_id}', 'LED_OFF')">
                        <i class="fas fa-lightbulb"></i> LED Kapat
                    </button>
                    <button class="control-btn" style="background:#007bff;color:white" 
                            onclick="dashboard.sendCommand('${device.device_id}', 'GET_STATUS')">
                        <i class="fas fa-sync-alt"></i> Durum
                    </button>
                </div>
            </div>
        `).join('');
    }

    sendCommand(deviceId, command) {
        fetch('/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_id: deviceId,
                command: command
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.addLog(`${deviceId}: ${command} komutu gönderildi`, 'success');
            } else {
                this.addLog(`${deviceId}: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            this.addLog(`${deviceId}: Komut gönderilemedi`, 'error');
            console.error('Komut hatası:', error);
        });
    }

    sendCommandToAll(command) {
        if (this.devices.length === 0) {
            this.addLog('Komut göndermek için cihaz bulunamadı', 'warning');
            return;
        }
        
        this.devices.forEach(device => {
            if (device.status === 'online') {
                this.sendCommand(device.device_id, command);
            }
        });
        
        this.addLog(`Tüm çevrimiçi cihazlara ${command} komutu gönderildi`, 'info');
    }

    addLog(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const logContainer = document.getElementById('logContainer');
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-message">${message}</span>
        `;
        
        logContainer.prepend(logEntry);
        
        // En fazla 50 log tut
        if (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.lastChild);
        }
        
        // Log'u kaydet
        this.logEntries.unshift({ time, message, type });
    }

    clearLogs() {
        const logContainer = document.getElementById('logContainer');
        logContainer.innerHTML = '';
        this.logEntries = [];
        this.addLog('Loglar temizlendi', 'info');
    }

    setupEventListeners() {
        // 10 saniyede bir cihaz listesini yenile
        setInterval(() => this.loadDevices(), 10000);
    }
}

// Global dashboard instance
const dashboard = new Dashboard();

// Global fonksiyonlar
function sendCommandToAll(command) {
    dashboard.sendCommandToAll(command);
}

function clearLogs() {
    dashboard.clearLogs();
}
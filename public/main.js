const logEl = document.getElementById('log');
const deviceSelect = document.getElementById('deviceSelect');
const devices = new Map();

const ws = new WebSocket(`wss://${location.host}/ws`);

ws.onopen = () => log('🌐 WebSocket bağlandı');
ws.onclose = () => log('🔴 WebSocket koptu');
ws.onmessage = (msg) => {
  try {
    const data = JSON.parse(msg.data);
    if(data.type === 'REGISTERED'){
      devices.set(data.deviceId, true);
      updateDeviceList();
      log(`📡 ESP32 Online: ${data.deviceId}`);
    }
  } catch(e){
    console.log('Mesaj:', msg.data);
  }
}

function log(txt){
  logEl.textContent += txt + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function updateDeviceList(){
  deviceSelect.innerHTML = '';
  for(const id of devices.keys()){
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    deviceSelect.appendChild(option);
  }
}

async function uploadOTA(){
  const file = document.getElementById('otaFile').files[0];
  const deviceId = deviceSelect.value;
  if(!file || !deviceId) return alert("Dosya veya cihaz seçmediniz");

  const formData = new FormData();
  formData.append('file', file);

  log(`📡 OTA başlatılıyor: ${deviceId}`);
  const resp = await fetch(`/ota/${deviceId}`, {
    method: 'POST',
    body: formData
  });

  const text = await resp.text();
  log(`📨 Server: ${text}`);
}

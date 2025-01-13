let ws;
const activeScans = new Map();

// DOM Elements
const statusElement = document.getElementById('status');
const startScanBtn = document.getElementById('start-scan');
const clearInputBtn = document.getElementById('clear-input');
const targetsInput = document.getElementById('targets');
const activeScansList = document.getElementById('activeScansList');
const scanHistoryList = document.getElementById('scanHistoryList');
const statusDot = document.querySelector('.status-dot');

// Initialize WebSocket
function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
        updateStatus('Connected', 'connected');
        startScanBtn.disabled = false;
        statusDot.classList.add('connected');
    };
    
    ws.onclose = () => {
        updateStatus('Disconnected', 'disconnected');
        startScanBtn.disabled = true;
        statusDot.classList.remove('connected');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection Error', 'error');
    };
    
    ws.onmessage = handleWebSocketMessage;
}

function handleWebSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);
        
        switch(message.type) {
            case 'initial-scans':
                handleInitialScans(message.data);
                break;
            case 'scan-started':
                handleScanStarted(message.data);
                break;
            case 'scan-output':
                handleScanOutput(message.data);
                break;
            case 'scan-completed':
                handleScanCompleted(message.data);
                break;
            case 'scan-error':
                handleScanError(message.data);
                break;
            case 'scan-stopped':
                handleScanStopped(message.data);
                break;
            case 'scan-deleted':
                handleScanDeleted(message.data);
                break;
            case 'history-cleared':
                handleHistoryCleared();
                break;
            case 'error':
                showNotification(message.message, 'error');
                break;
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
}

function startScan() {
    const targets = targetsInput.value
        .split('\n')
        .map(t => t.trim())
        .filter(t => t);
    
    if (targets.length === 0) {
        showNotification('Please enter at least one target URL', 'error');
        return;
    }

    const templateSelect = document.getElementById('template-select');
    const selectedTemplate = templateSelect.value;

    const dastMode = document.getElementById('dast-mode').checked; 

    ws.send(JSON.stringify({
        action: 'start-scan',
        targets: targets,
        customTemplate: selectedTemplate === 'default' ? null : selectedTemplate, 
        dastMode: dastMode 
    }));
    
    targetsInput.value = '';
    showNotification('Scan started', 'success');
}


function sanitizeOutput(output) {
    return output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function extractDomain(url) {
    try {
        const urlObject = new URL(url);
        return urlObject.hostname;
    } catch (error) {
        return url;
    }
}

function extractURL(text) {
    const matches = text.match(/https?:\/\/[^\s"\]]+/);
    return matches ? matches[0] : '';
}

function handleScanOutput(data) {
    const element = document.getElementById(`scan-${data.id}`);
    if (!element) return;

    const findingsList = element.querySelector('.findings-list');
    const sanitizedOutput = sanitizeOutput(data.output);
    const lines = sanitizedOutput.split('\n').filter(line => line.trim() !== '');

    lines.forEach(line => {
        try {
            // Parse the line
            const match = line.match(/\[(.*?)\] \[(.*?)\] \[(.*?)\] (.*)/);
            if (!match) return;

            const [_, template, type, severity, rest] = match;
            
            // Extract URL and remaining details
            const url = extractURL(rest);
            const details = rest.replace(url, '').replace(/[\[\]"]/g, '').trim();

            // Create table row
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="template-col">${template || 'N/A'}</td>
                <td class="type-col">${type || 'N/A'}</td>
                <td class="severity-col">
                    <span class="severity-badge ${severity.toLowerCase()}">${severity}</span>
                </td>
                <td class="url-col">
                    ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` : 'N/A'}
                </td>
                <td class="host-col">${url ? extractDomain(url) : 'N/A'}</td>
                <td class="details-col">${details}</td>
            `;

            findingsList.appendChild(row);

            // Sort rows by severity
            const rows = Array.from(findingsList.getElementsByTagName('tr'));
            const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
            
            rows.sort((a, b) => {
                const severityA = a.querySelector('.severity-badge').textContent.toLowerCase();
                const severityB = b.querySelector('.severity-badge').textContent.toLowerCase();
                return severityOrder[severityA] - severityOrder[severityB];
            });
            
            rows.forEach(row => findingsList.appendChild(row));
        } catch (error) {
            console.error('Error parsing line:', line, error);
        }
    });
}

function handleInitialScans(scans) {
    scans.forEach(scan => {
        const element = createScanElement(scan);
        if (scan.status === 'running') {
            activeScansList.appendChild(element);
        } else {
            scanHistoryList.appendChild(element);
        }
    });
}

function createScanElement(scan) {
    const template = document.getElementById('scanItemTemplate');
    const element = template.content.firstElementChild.cloneNode(true);
    
    element.id = `scan-${scan.id}`;
    element.querySelector('.scan-target').textContent = scan.target;
    element.querySelector('.scan-status').textContent = scan.status;
    element.querySelector('.scan-status').className = `scan-status ${scan.status}`;
    element.querySelector('.scan-timestamp').textContent = 
        `Started: ${new Date(scan.startTime).toLocaleString()}`;

    // Set up event listeners
    if (scan.status === 'running') {
        element.querySelector('.stop-scan-btn').addEventListener('click', () => stopScan(scan.id));
    } else {
        element.querySelector('.stop-scan-btn').remove();
    }
    
    element.querySelector('.delete-scan-btn').addEventListener('click', () => deleteScan(scan.id));
    element.querySelector('.export-scan-btn').addEventListener('click', () => exportScan(scan.id));
    
    return element;
}

function handleScanStarted(scan) {
    const element = createScanElement(scan);
    activeScansList.appendChild(element);
    showNotification(`Scan started for ${scan.target}`, 'info');
}

function handleScanCompleted(scan) {
    const element = document.getElementById(`scan-${scan.id}`);
    if (element) {
        element.querySelector('.scan-status').textContent = 'completed';
        element.querySelector('.scan-status').className = 'scan-status completed';
        element.querySelector('.stop-scan-btn')?.remove();
        scanHistoryList.appendChild(element);
    }
    showNotification(`Scan completed for ${scan.target}`, 'success');
}

function handleScanError(scan) {
    const element = document.getElementById(`scan-${scan.id}`);
    if (element) {
        element.querySelector('.scan-status').textContent = 'error';
        element.querySelector('.scan-status').className = 'scan-status error';
        element.querySelector('.stop-scan-btn')?.remove();
    }
    showNotification(`Error in scan for ${scan.target}`, 'error');
}

function handleScanStopped(scan) {
    const element = document.getElementById(`scan-${scan.id}`);
    if (element) {
        element.querySelector('.scan-status').textContent = 'stopped';
        element.querySelector('.scan-status').className = 'scan-status stopped';
        element.querySelector('.stop-scan-btn')?.remove();
        scanHistoryList.appendChild(element);
    }
    showNotification(`Scan stopped for ${scan.target}`, 'warning');
}

function handleScanDeleted(data) {
    const element = document.getElementById(`scan-${data.scanId}`);
    element?.remove();
}

function handleHistoryCleared() {
    while (scanHistoryList.firstChild) {
        scanHistoryList.removeChild(scanHistoryList.firstChild);
    }
    showNotification('Scan history cleared', 'success');
}

function clearAllScans(type) {
    ws.send(JSON.stringify({
        action: type === 'active' ? 'clear-active' : 'clear-history'
    }));
}

function stopScan(scanId) {
    ws.send(JSON.stringify({
        action: 'stop-scan',
        scanId: scanId
    }));
}

function deleteScan(scanId) {
    ws.send(JSON.stringify({
        action: 'delete-scan',
        scanId: scanId
    }));
}

function exportScan(scanId) {
    const element = document.getElementById(`scan-${scanId}`);
    if (!element) return;

    const findings = Array.from(element.querySelectorAll('.findings-list tr')).map(row => ({
        template: row.querySelector('.template-col').textContent,
        type: row.querySelector('.type-col').textContent,
        severity: row.querySelector('.severity-badge').textContent,
        url: row.querySelector('.url-col a')?.href || 'N/A',
        host: row.querySelector('.host-col').textContent,
        details: row.querySelector('.details-col').textContent
    }));

    const scanData = {
        target: element.querySelector('.scan-target').textContent,
        status: element.querySelector('.scan-status').textContent,
        startTime: element.querySelector('.scan-timestamp').textContent,
        findings: findings
    };

    const blob = new Blob([JSON.stringify(scanData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nuclei-scan-${scanId}-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function updateStatus(message, status) {
    statusElement.textContent = message;
    statusElement.className = `status ${status}`;
    statusDot.className = `status-dot ${status}`;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    const container = document.getElementById('notifications');
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Event Listeners
startScanBtn.addEventListener('click', startScan);
clearInputBtn.addEventListener('click', () => {
    targetsInput.value = '';
});

document.getElementById('clear-all-active').addEventListener('click', () => clearAllScans('active'));
document.getElementById('clear-all-history').addEventListener('click', () => clearAllScans('history'));

// Initialize connection
connectWebSocket();
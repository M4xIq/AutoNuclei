const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const morgan = require('morgan');
const fs = require('fs');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(__dirname ));

const DATA_FILE = path.join(__dirname, 'data', 'scans.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({})); 
}

let activeScans = new Map();
const scanProcesses = new Map();

function loadSavedScans() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const scans = JSON.parse(data);
            activeScans = new Map(Object.entries(scans)); 

            for (const [scanId, scan] of activeScans.entries()) {
                if (scan.status === 'running') {
                    console.log(`Restarting scan for ${scan.target} with ID ${scanId}`);
                    startNucleiScan(scanId, scan.target, scan.customTemplate, scan.dastMode); 
                }
            }

            console.log('Loaded saved scans:', activeScans.size);
        } else {
            console.log('No saved scans found.');
        }
    } catch (error) {
        console.error('Error loading saved scans:', error);
    }
}

function saveScanData() {
    try {
        const scansObject = Object.fromEntries(activeScans); 
        fs.writeFileSync(DATA_FILE, JSON.stringify(scansObject, null, 2)); 
        console.log('Scan data saved successfully.');
    } catch (error) {
        console.error('Error saving scan data:', error);
    }
}

loadSavedScans();

// WebSocket connection handler
wss.on('connection', function connection(ws) {
    console.log('New client connected');

    const scans = Array.from(activeScans.values());
    ws.send(JSON.stringify({
        type: 'initial-scans',
        data: scans
    }));

    ws.on('message', async function incoming(message) {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            switch (data.action) {
                case 'start-scan':
                    handleStartScan(ws, data);
                    break;
                case 'stop-scan':
                    handleStopScan(ws, data.scanId);
                    break;
                case 'delete-scan':
                    handleDeleteScan(ws, data.scanId);
                    break;
                case 'clear-history':
                    handleClearHistory(ws);
                    break;
                case 'clear-active':
                    handleClearActive(ws);
                    break;
                case 'start-tool2':
                    handleStartTool2(ws, data);
                    break;
                case 'stop-tool2':
                    handleStopTool2(ws, data.scanId);
                    break;
                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Unknown action'
                    }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

async function handleStartScan(ws, data) {
    if (!Array.isArray(data.targets) || data.targets.length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid targets'
        }));
        return;
    }

    for (const target of data.targets) {
        const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`Starting scan for ${target} with ID ${scanId}`);

        try {
            startNucleiScan(scanId, target, data.customTemplate, data.dastMode);

            ws.send(JSON.stringify({
                type: 'scan-started',
                data: activeScans.get(scanId) 
            }));
        } catch (error) {
            console.error(`Error running scan: ${error}`);
            ws.send(JSON.stringify({
                type: 'error',
                message: `Error scanning ${target}: ${error.message}`
            }));
        }
    }
}

function startNucleiScan(scanId, target, customTemplate, dastMode) {
    const scanData = {
        id: scanId,
        target: target,
        status: 'running',
        startTime: new Date(),
        findings: [],
        output: [],
        customTemplate: customTemplate,
        dastMode: dastMode 
    };

    activeScans.set(scanId, scanData);
    saveScanData(); 

    const args = ['-u', target];
    if (customTemplate) {
        args.push('-t', customTemplate); 
    }
    if (dastMode) {
        args.push('-dast'); 
    }

    const nuclei = spawn('nuclei', args, {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    console.log(`Executing: nuclei ${args.join(' ')}`);

    scanProcesses.set(scanId, nuclei);

    nuclei.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Nuclei output:', output);

        const scan = activeScans.get(scanId);
        if (scan) {
            scan.output.push(output);
            saveScanData();
        }

        broadcast({
            type: 'scan-output',
            data: {
                id: scanId,
                output: output
            }
        });
    });

    nuclei.stderr.on('data', (data) => {
        const errorMsg = data.toString();
        console.error(`Nuclei stderr for ${target}:`, errorMsg);

        broadcast({
            type: 'scan-log',
            data: {
                id: scanId,
                message: errorMsg,
                isError: true
            }
        });
    });

    nuclei.on('error', (error) => {
        console.error(`Nuclei process error for ${target}:`, error);
        const scan = activeScans.get(scanId);
        if (scan) {
            scan.status = 'error';
            scan.error = error.message;
            scan.endTime = new Date();
            saveScanData();

            broadcast({
                type: 'scan-error',
                data: scan
            });
        }
    });

    nuclei.on('close', (code) => {
        console.log(`Nuclei process closed with code ${code} for ${target}`);
        const scan = activeScans.get(scanId);
        if (scan) {
            scan.status = code === 0 ? 'completed' : 'error';
            scan.endTime = new Date();
            saveScanData();

            broadcast({
                type: 'scan-completed',
                data: scan
            });

            scanProcesses.delete(scanId);
        }
    });
}

function handleStopScan(ws, scanId) {
    const process = scanProcesses.get(scanId);
    const scan = activeScans.get(scanId);

    if (process && scan) {
        process.kill();
        scan.status = 'stopped';
        scan.endTime = new Date();
        saveScanData(); 

        ws.send(JSON.stringify({
            type: 'scan-stopped',
            data: scan
        }));

        scanProcesses.delete(scanId);
    }
}

function handleDeleteScan(ws, scanId) {
    const scan = activeScans.get(scanId);
    if (scan) {
        if (scan.status === 'running') {
            handleStopScan(ws, scanId);
        }

        activeScans.delete(scanId);
        saveScanData();

        ws.send(JSON.stringify({
            type: 'scan-deleted',
            data: { scanId }
        }));
    }
}

function handleClearHistory(ws) {
    let deletedCount = 0;
    for (const [scanId, scan] of activeScans.entries()) {
        if (scan.status !== 'running') {
            activeScans.delete(scanId);
            deletedCount++;
        }
    }

    saveScanData(); 

    ws.send(JSON.stringify({
        type: 'history-cleared',
        data: { deletedCount }
    }));
}

function handleClearActive(ws) {
    let deletedCount = 0;
    for (const [scanId, scan] of activeScans.entries()) {
        if (scan.status === 'running') {
            handleStopScan(ws, scanId);
            activeScans.delete(scanId);
            deletedCount++;
        }
    }

    saveScanData();

    ws.send(JSON.stringify({
        type: 'active-cleared',
        data: { deletedCount }
    }));
}

async function handleStartTool2(ws, data) {
    // Implement the logic to start Tool 2
    console.log('Starting Tool 2:', data);
}

function handleStopTool2(ws, scanId) {
    // Implement the logic to stop Tool 2
    console.log('Stopping Tool 2:', scanId);
}

function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Clean up on process exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    saveScanData(); 
    process.exit(0);
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
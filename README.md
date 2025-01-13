# AutoNuclei
![image](https://github.com/user-attachments/assets/c51cc86f-81f3-455b-9e95-6a2ecc72f78f)

## Overview
AutoNuclei is an advanced web security scanning tool designed to automate and streamline vulnerability detection using Nuclei. It provides a user-friendly interface for running comprehensive security scans across multiple targets with enhanced flexibility and control.

## Key Features

### 🔍 Comprehensive Scanning
- Support for multiple target URLs
- Customizable scan templates
- Dynamic Attack Surface Mapping (DAST) mode

### 🛡️ Flexible Configuration
- Multiple template selection options
- Custom template support
- Toggle DAST mode for in-depth scanning

### 📊 Real-time Reporting
- Detailed scan results tracking
- Severity-based finding classification
- Interactive findings table
- Export capabilities for scan results

## Technologies Used
- Frontend: HTML5, CSS3, JavaScript
- Backend: Node.js, Express.js
- WebSocket: Real-time communication
- Security Tool: Nuclei

### Requirements
```bash
# Core dependencies
npm install express
npm install ws
npm install morgan
npm install child_process
```
### Installation Steps
```bash
# Clone the repository
git clone https://github.com/M4xIq/AutoNuclei.git

# Navigate to project directory
cd AutoNuclei

# Install dependencies
npm install

# Install Nuclei
go install -v github.com/projectdiscovery/nuclei/v2/cmd/nuclei@latest
```

## Usage
1. Enter target URLs
2. Select scanning template
3. Toggle DAST mode if needed
4. Start scan
5. Monitor results in real-time

## Security Modes
- **Standard Mode**: Quick vulnerability detection
- **DAST Mode**: Deep, dynamic application security testing

## Scan Management
- Start/Stop scans dynamically
- Delete individual scan results
- Clear scan history
- Export results in JSON format



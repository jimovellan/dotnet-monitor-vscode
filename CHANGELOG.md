# Change Log

All notable changes to the "dotnet-monitor-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [0.0.1] - 2025-11-23

### 🎉 Initial Release

#### Added
- ✨ Interactive dashboard with Vue.js for monitoring .NET processes
- 📊 Real-time memory metrics visualization (Working Set and GC Heap Size)
- 📈 Chart.js integration for beautiful, responsive graphs
- 🔄 Automatic reconnection when dotnet-monitor stream disconnects
- ⚙️ Configurable settings for ports, reconnection behavior, and data points
- 🎨 Modern UI with Tailwind CSS
- 🔍 Process selector to choose which .NET application to monitor
- 📡 HTTPS/HTTP support for dotnet-monitor API

#### Features
- Command: `Mostrar Dashboard Dotnet Monitor`
- Configuration options:
  - `dotnetMonitor.port` - HTTPS port (default: 52323)
  - `dotnetMonitor.httpPort` - HTTP port (default: 52325)
  - `dotnetMonitor.autoReconnect` - Auto-reconnect flag (default: true)
  - `dotnetMonitor.reconnectDelay` - Reconnection delay in ms (default: 2000)
  - `dotnetMonitor.maxDataPoints` - Max chart data points (default: 30)
  - `dotnetMonitor.commandArgs` - dotnet-monitor command arguments

#### Technical
- Vue 3.5.24 with Options API
- Chart.js 4.5.1 for data visualization
- Tailwind CSS 3.4.0 for styling
- TypeScript support
- Webview-based architecture with message passing

---

## [Unreleased]

### Planned Features
- CPU usage metrics
- Thread count monitoring
- Exception tracking
- Request rate visualization
- Custom metric alerts
- Export data functionality
- Multiple process monitoring simultaneously
- Dark/Light theme support

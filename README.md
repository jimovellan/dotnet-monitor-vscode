# 🔍 Dotnet Monitor for VS Code

**English** | [Español](README.es.md)

Monitor and analyze your .NET application performance directly from Visual Studio Code. This extension provides an integrated visual interface for [dotnet-monitor](https://github.com/dotnet/dotnet-monitor), displaying real-time metrics from your .NET processes.

## ✨ Features

- 📊 **Real-time dashboard** - Visualize metrics from your .NET applications while they run
- 🧠 **Memory metrics** - Monitor Working Set and GC Heap Size with interactive charts
- 🔄 **Auto-reconnect** - Automatically reconnects if the connection to dotnet-monitor is lost
- ⚙️ **Highly configurable** - Customize ports, arguments and extension behavior
- 🎨 **Modern interface** - Visual dashboard with interactive charts

## 📋 Requirements

Before using this extension, you need to have installed:

1. **.NET SDK** (version 6.0 or higher)
2. **dotnet-monitor** - Install it globally with:
   ```bash
   dotnet tool install -g dotnet-monitor
   ```

## 🚀 Usage

1. Open the **Command Palette** (`Cmd+Shift+P` on macOS / `Ctrl+Shift+P` on Windows/Linux)
2. Type `Mostrar Dashboard Dotnet Monitor` and select the command
3. The dashboard will open showing all running .NET processes
4. Select a process to start monitoring its real-time metrics

## 📊 Available Metrics

Currently, the extension monitors the following memory metrics:

- **Working Set (MB)** - Total physical memory used by the process
- **GC Heap Size (MB)** - Size of the heap managed by the Garbage Collector

*More metrics in development: CPU, threads, exceptions, etc.*

## 🛠️ Development

If you want to contribute or modify the extension:

```bash
# Clone the repository
git clone https://github.com/jimovellan/dotnet-monitor-vscode.git
cd dotnet-monitor-vscode

# Install dependencies
npm install

# Compile
npm run compile

# Run in watch mode (development)
npm run watch

# Run tests
npm test
```

Press `F5` in VS Code to start the extension in debug mode.

## 🐛 Known Issues

- The extension requires dotnet-monitor to be installed globally
- On some systems, manual port configuration may be necessary if there are conflicts

## 📝 Release Notes

### 0.0.1

🎉 **Initial release**

- Interactive dashboard
- Real-time memory metrics monitoring
- Real-time charts
- Automatic reconnection
- Flexible configuration

---

## 📄 License

[MIT](LICENSE)

## 🤝 Contributing

Contributions are welcome! Please open an issue or pull request on [GitHub](https://github.com/jimovellan/dotnet-monitor-vscode).

## 👨‍💻 Author

**Jose Ignacio Movellan** - [@jimovellan](https://github.com/jimovellan)

---

**Enjoy monitoring your .NET applications!** 🚀

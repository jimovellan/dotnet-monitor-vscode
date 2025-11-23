# 🔍 Dotnet Monitor for VS Code

[English](README.md) | **Español**

Monitoriza y analiza el rendimiento de tus aplicaciones .NET directamente desde Visual Studio Code. Esta extensión proporciona una interfaz visual integrada para [dotnet-monitor](https://github.com/dotnet/dotnet-monitor), mostrando métricas en tiempo real de tus procesos .NET.

## ✨ Características

- 📊 **Dashboard en tiempo real** - Visualiza métricas de tus aplicaciones .NET mientras se ejecutan
- 🧠 **Métricas de memoria** - Monitoriza Working Set y GC Heap Size con gráficos interactivos
- 🔄 **Reconexión automática** - Se reconecta automáticamente si se pierde la conexión con dotnet-monitor
- ⚙️ **Altamente configurable** - Personaliza puertos, argumentos y comportamiento de la extensión
- 🎨 **Interfaz moderna** - Dashboard visual con gráficos interactivos

## 📋 Requisitos

Antes de usar esta extensión, necesitas tener instalado:

1. **.NET SDK** (versión 6.0 o superior)
2. **dotnet-monitor** - Instálalo globalmente con:
   ```bash
   dotnet tool install -g dotnet-monitor
   ```

## 🚀 Uso

1. Abre la **Paleta de Comandos** (`Cmd+Shift+P` en macOS / `Ctrl+Shift+P` en Windows/Linux)
2. Escribe `Mostrar Dashboard Dotnet Monitor` y selecciona el comando
3. El dashboard se abrirá mostrando todos los procesos .NET en ejecución
4. Selecciona un proceso para comenzar a monitorizar sus métricas en tiempo real

## 📊 Métricas Disponibles

Actualmente, la extensión monitoriza las siguientes métricas de memoria:

- **Working Set (MB)** - Memoria física total utilizada por el proceso
- **GC Heap Size (MB)** - Tamaño del heap gestionado por el Garbage Collector

*Más métricas en desarrollo: CPU, threads, excepciones, etc.*

## 🛠️ Desarrollo

Si quieres contribuir o modificar la extensión:

```bash
# Clonar el repositorio
git clone https://github.com/jimovellan/dotnet-monitor-vscode.git
cd dotnet-monitor-vscode

# Instalar dependencias
npm install

# Compilar
npm run compile

# Ejecutar en modo watch (desarrollo)
npm run watch

# Ejecutar tests
npm test
```

Presiona `F5` en VS Code para iniciar la extensión en modo debug.

## 🐛 Problemas Conocidos

- La extensión requiere que dotnet-monitor esté instalado globalmente
- En algunos sistemas, puede ser necesario configurar manualmente los puertos si hay conflictos

## 📝 Notas de Versión

### 0.0.1

🎉 **Lanzamiento inicial**

- Dashboard interactivo
- Monitorización de métricas de memoria en tiempo real
- Gráficos en tiempo real
- Reconexión automática
- Configuración flexible

---

## 📄 Licencia

[MIT](LICENSE)

## 🤝 Contribuir

Las contribuciones son bienvenidas! Por favor, abre un issue o pull request en [GitHub](https://github.com/jimovellan/dotnet-monitor-vscode).

## 👨‍💻 Autor

**Jose Ignacio Movellan** - [@jimovellan](https://github.com/jimovellan)

---

**¡Disfruta monitorizando tus aplicaciones .NET!** 🚀

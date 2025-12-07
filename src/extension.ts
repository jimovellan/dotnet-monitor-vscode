// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

// Función para obtener la configuración
function getConfig() {
	const config = vscode.workspace.getConfiguration('dotnetMonitor');
	return {
		port: config.get<number>('port', 52323),
		httpPort: config.get<number>('httpPort', 52325),
		autoReconnect: config.get<boolean>('autoReconnect', true),
		reconnectDelay: config.get<number>('reconnectDelay', 2000),
		maxDataPoints: config.get<number>('maxDataPoints', 30),
		commandArgs: config.get<string[]>('commandArgs', ['collect', '--no-auth', '--urls', `https://localhost:${config.port},http://localhost:${config.httpPort}`])
	};
}

// Función auxiliar para hacer fetch con soporte para certificados autofirmados
async function fetchWithAgent(url: string): Promise<Response> {
	const isHttps = url.startsWith('https');
	
	if (isHttps) {
		// Para HTTPS, usar https.get con rejectUnauthorized: false
		return new Promise((resolve, reject) => {
			https.get(url, { rejectUnauthorized: false }, (res) => {
				let data = '';
				res.on('data', chunk => data += chunk);
				res.on('end', () => {
					resolve({
						ok: res.statusCode! >= 200 && res.statusCode! < 300,
						status: res.statusCode!,
						json: async () => JSON.parse(data),
						text: async () => data
					} as Response);
				});
			}).on('error', reject);
		});
	} else {
		// Para HTTP, usar fetch normal
		return fetch(url);
	}
}

// Función para verificar si dotnet-monitor está instalado
async function checkDotnetMonitor(): Promise<{ installed: boolean; version?: string; error?: string }> {
	try {
		const { stdout } = await execAsync('dotnet-monitor --version');
		const version = stdout.trim();
		return { installed: true, version };
	} catch (error: any) {
		return { 
			installed: false, 
			error: error.message 
		};
	}
}

// Función para esperar a que la API esté disponible
async function esperarAPI(url: string, maxIntentos: number = 30): Promise<boolean> {
	console.log(`⏳ Esperando a que la API esté disponible en ${url}...`);
	for (let i = 0; i < maxIntentos; i++) {
		try {
			const response = await fetchWithAgent(url);
			console.log(`Intento ${i + 1}: Estado de la API - ${response.status}`);
			console.log(response);
			if (response.ok) {
				return true;
			}
		} catch (error) {
			// La API aún no está lista, esperar
		}
		await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo
	}
	return false;
}

// Función para leer stream de métricas en formato JSON Sequence (RFC 7464)
// La API devuelve application/json-seq que usa el separador \x1E (Record Separator) antes de cada JSON
function iniciarStreamMetricas(pid: number, panel: vscode.WebviewPanel) {
	const config = getConfig();
	const url = `https://localhost:${config.port}/livemetrics?pid=${pid}`;
	let activo = true;
	let requestActual: http.ClientRequest | null = null;
	
	const conectar = () => {
		if (!activo) {
			return;
		}
		
		console.log(`🌊 Iniciando stream de métricas para PID ${pid} en puerto ${config.port}`);
		
		requestActual = https.get(url, { rejectUnauthorized: false }, (response) => {
			console.log(`✅ Conectado al stream (status: ${response.statusCode})`);
			
			let buffer = '';
			const RECORD_SEPARATOR = '\x1E'; // ASCII Record Separator para JSON Sequence
			
			// Procesar datos conforme llegan
			response.on('data', (chunk) => {
				buffer += chunk.toString();
				
				// Buscar registros completos separados por \x1E
				let separatorIndex;
				while ((separatorIndex = buffer.indexOf(RECORD_SEPARATOR)) !== -1) {
					const record = buffer.substring(0, separatorIndex).trim();
					buffer = buffer.substring(separatorIndex + 1);
					
					if (record) {
						try {
							const metrica = JSON.parse(record);
							console.log('📊 Métrica recibida:', metrica.name, '=', metrica.value);
							
							// Enviar al webview
							panel.webview.postMessage({
								command: 'actualizarMetrica',
								data: metrica
							});
						} catch (error) {
							console.error('❌ Error parseando JSON Sequence record:', error);
						}
					}
				}
			});
			
			response.on('end', () => {
				console.log(`🔚 Stream terminado - ${config.autoReconnect ? `Reconectando en ${config.reconnectDelay}ms...` : 'No reconectando (autoReconnect deshabilitado)'}`);
				
				// Procesar cualquier registro final que quedó en el buffer
				if (buffer.trim()) {
					try {
						const metrica = JSON.parse(buffer.trim());
						console.log('📊 Métrica final recibida:', metrica.name, '=', metrica.value);
						panel.webview.postMessage({
							command: 'actualizarMetrica',
							data: metrica
						});
					} catch (error) {
						console.log('⚠️ Buffer final no es JSON válido (puede ser normal si el stream se cortó)');
					}
				}
				
				// Reconectar automáticamente después de un breve delay si está habilitado
				if (activo && config.autoReconnect) {
					setTimeout(conectar, config.reconnectDelay);
				}
			});
			
			response.on('error', (error) => {
				console.error('❌ Error en stream:', error);
				// Reconectar en caso de error si está habilitado
				if (activo && config.autoReconnect) {
					setTimeout(conectar, config.reconnectDelay);
				}
			});
		});
		
		requestActual.on('error', (error) => {
			console.error('❌ Error conectando al stream:', error);
			// Reconectar en caso de error si está habilitado
			if (activo && config.autoReconnect) {
				setTimeout(conectar, config.reconnectDelay);
			}
		});
	};
	
	// Iniciar la primera conexión
	conectar();
	
	// Retornar función para cancelar el stream
	return () => {
		console.log('🛑 Cerrando stream de métricas');
		activo = false;
		if (requestActual) {
			requestActual.destroy();
		}
	};
}

// Función para obtener la lista de procesos
async function obtenerProcesos(): Promise<any[]> {
	try {
		const config = getConfig();
		console.log('🔍 Intentando obtener procesos desde la API...');
		
		// Probar primero la raíz para ver qué endpoints hay
		const rootResponse = await fetchWithAgent(`http://localhost:${config.httpPort}/`);
		console.log('Root status:', rootResponse.status);
		if (rootResponse.ok) {
			const rootData = await rootResponse.text();
			console.log('Root response:', rootData);
		}
		
		// Ahora probar /processes
		const response = await fetchWithAgent(`https://localhost:${config.port}/processes`);
		console.log('Processes status:', response.status);
		
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json() as any[];
		console.log('✅ Procesos obtenidos:', data);
		
		// Obtener el nombre del programa en debug (si existe)
		let debugProgramName: string | null = null;
		const debugSession = vscode.debug.activeDebugSession;
		
		if (debugSession && (debugSession.type === 'coreclr' || debugSession.type === 'clr')) {
			// Obtener el nombre del programa desde la configuración
			const programPath = debugSession.configuration?.program;
			if (programPath) {
				// Extraer solo el nombre del archivo desde la ruta completa
				debugProgramName = programPath.split('/').pop()?.split('\\').pop() || null;
				console.log('🐛 Programa en debug detectado:', debugProgramName);
			}
		}
		
		const blackLists = ['microsoft.visualstudio.'];
		
		// Filtrar y marcar el proceso en debug
		return data
			.filter(prop => !blackLists.some(blackList => 
				prop.name.toLowerCase().startsWith(blackList) || 
				prop.name.toLowerCase() === 'dotnet'
			))
			.map(proceso => ({
				...proceso,
				isDebugging: debugProgramName !== null && proceso.name?.toLowerCase() === debugProgramName.toLowerCase()
			}));
	} catch (error: any) {
		console.error('Error obteniendo procesos:', error);
		return [];
	}
}



// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('==========================================');
	console.log('🚀 DOTNET MONITOR EXTENSION ACTIVATING!!!');
	console.log('==========================================');
	
	vscode.window.showInformationMessage('Dotnet Monitor extension is now active!');
	
	console.log('Congratulations, your extension "dotnet-monitor-vscode" is now active!');

	// ----- NUEVO COMANDO: MOSTRAR WEBVIEW -----
	const dashboardCmd = vscode.commands.registerCommand(
		'dotnetMonitor.showDashboard',
		async () => {
			const config = getConfig();
			
			// Verificar si dotnet-monitor está instalado
			const monitorCheck = await checkDotnetMonitor();
			
			if (!monitorCheck.installed) {
				vscode.window.showErrorMessage(
					'dotnet-monitor no está instalado. Ejecuta: dotnet tool install -g dotnet-monitor'
				);
				return;
			}

			const panel = vscode.window.createWebviewPanel(
				'dotnetDashboard',
				'Dotnet Monitor Dashboard',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
			);

			// Mostrar loading inicial
			panel.webview.html = getLoadingHTML('Iniciando dotnet-monitor...');

			// Iniciar dotnet-monitor con argumentos configurables
			const monitorProcess = spawn('dotnet-monitor', config.commandArgs);
			console.log('✅ Dotnet Monitor iniciado con PID:', monitorProcess.pid);
			console.log('📝 Argumentos:', config.commandArgs.join(' '));
			console.log('🔌 Puerto HTTPS:', config.port);
			console.log('🔌 Puerto HTTP:', config.httpPort);

			// Capturar errores del proceso
			monitorProcess.stderr?.on('data', (data) => {
				console.error('dotnet-monitor error:', data.toString());
			});

			// Esperar a que la API esté lista
			panel.webview.html = getLoadingHTML('Esperando a que la API esté lista...');
			const apiReady = await esperarAPI(`https://localhost:${config.port}/processes`);

			if (!apiReady) {
				panel.webview.html = getErrorHTML('No se pudo conectar a la API de dotnet-monitor');
				monitorProcess.kill();
				return;
			}

			// Obtener lista de procesos
			loadProcesosHtml(panel, monitorProcess);

			// Variable para guardar la función de cancelación del stream
			let cancelarStream: (() => void) | null = null;

			// 🎯 ESCUCHAR MENSAJES DEL WEBVIEW
			panel.webview.onDidReceiveMessage(
				async (mensaje) => {
					console.log('📨 Mensaje recibido del webview:', mensaje);

					if(mensaje.command === 'obtenerProcesos') {
						loadProcesosHtml(panel, monitorProcess);
					}

					if (mensaje.command === 'backToList') {
						console.log('🔙 Volviendo a la lista de procesos...');
						
						// Si hay un stream anterior, cancelarlo
						if (cancelarStream) {
							cancelarStream();
							cancelarStream = null;
						}
						
						// Volver a cargar la lista de procesos
						loadProcesosHtml(panel, monitorProcess);
					}

					if (mensaje.command === 'seleccionarProceso') {
						const pid = mensaje.pid;
						console.log(`✅ Usuario seleccionó proceso con PID: ${pid}`);
						
						// Si hay un stream anterior, cancelarlo
						if (cancelarStream) {
							cancelarStream();
						}
						
						// Mostrar HTML con gráficos
						panel.webview.html = getMetricsHTML(pid);
						
						// Iniciar stream de métricas
						cancelarStream = iniciarStreamMetricas(pid, panel);
					}
				}
			);

			// Limpiar al cerrar el panel
			panel.onDidDispose(() => {
				console.log('🛑 Cerrando dotnet-monitor con PID:', monitorProcess.pid);
				
				// Cancelar stream si existe
				if (cancelarStream) {
					cancelarStream();
				}
				
				monitorProcess.kill();
			});
		}
	);
	context.subscriptions.push(dashboardCmd);
}

async function loadProcesosHtml(panel: vscode.WebviewPanel, monitorProcess: ChildProcess) {
		panel.webview.html = getLoadingHTML('Obteniendo lista de procesos...');
			const procesos = await obtenerProcesos();

			if (procesos.length === 0) {
				panel.webview.html = getErrorHTML('No se encontraron procesos .NET en ejecución');
				monitorProcess.kill();
				return;
			}

			// Mostrar lista de procesos
			panel.webview.html = getProcessListHTML(procesos);
}

// Función para generar HTML de loading
function getLoadingHTML(mensaje: string): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body {
					padding: 20px;
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					display: flex;
					justify-content: center;
					align-items: center;
					height: 100vh;
					margin: 0;
				}
				.loading {
					text-align: center;
				}
				.spinner {
					border: 4px solid rgba(255, 255, 255, 0.1);
					border-left-color: #4ec9b0;
					border-radius: 50%;
					width: 40px;
					height: 40px;
					animation: spin 1s linear infinite;
					margin: 0 auto 20px;
				}
				@keyframes spin {
					to { transform: rotate(360deg); }
				}
			</style>
		</head>
		<body>
			<div class="loading">
				<div class="spinner"></div>
				<p>${mensaje}</p>
			</div>
		</body>
		</html>
	`;
}

// Función para generar HTML de error
function getErrorHTML(mensaje: string): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body {
					padding: 20px;
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
				}
				.error {
					color: #f48771;
					font-size: 24px;
					margin-bottom: 10px;
				}
			</style>
		</head>
		<body>
			<h1 class="error">❌ Error</h1>
			<p>${mensaje}</p>
		</body>
		</html>
	`;
}

// Función para generar HTML con lista de procesos
function getProcessListHTML(procesos: any[]): string {
	const procesosHTML = procesos.map(proc => `
		<div class="proceso-item ${proc.isDebugging ? 'debugging' : ''}" onclick="seleccionarProceso(${proc.pid})">
			<div class="proceso-info">
				<span class="proceso-pid">PID: ${proc.pid}</span>
				<span class="proceso-name">${proc.name || 'N/A'}</span>
				${proc.isDebugging ? '<span class="debug-badge">🐛 DEBUGGING</span>' : ''}
			</div>
			<div class="proceso-command">${proc.commandLine || 'N/A'}</div>
		</div>
	`).join('');

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body {
					padding: 20px;
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					margin: 0;
				}
				h1 {
					color: #4ec9b0;
					margin-bottom: 20px;
				}
				.proceso-item {
					padding: 15px;
					margin: 10px 0;
					background-color: var(--vscode-editor-inactiveSelectionBackground);
					border: 1px solid var(--vscode-panel-border);
					border-radius: 5px;
					cursor: pointer;
					transition: all 0.2s;
				}
				.proceso-item:hover {
					background-color: var(--vscode-list-hoverBackground);
					border-color: #4ec9b0;
				}
				.proceso-info {
					display: flex;
					gap: 20px;
					margin-bottom: 5px;
					align-items: center;
				}
				.proceso-pid {
					font-weight: bold;
					color: #4ec9b0;
				}
				.proceso-name {
					color: var(--vscode-foreground);
				}
				.debug-badge {
					background-color: #f48771;
					color: #000;
					padding: 2px 8px;
					border-radius: 4px;
					font-size: 0.75em;
					font-weight: bold;
					margin-left: 10px;
				}
				.proceso-item.debugging {
					border-left: 3px solid #f48771;
					background-color: rgba(244, 135, 113, 0.1);
				}
				.proceso-command {
					font-size: 0.9em;
					color: var(--vscode-descriptionForeground);
					font-family: monospace;
				}
			</style>
		</head>
		<body>
			<h1>� Selecciona un proceso .NET</h1>
			<div id="lista-procesos">
				${procesosHTML}
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				
				function seleccionarProceso(pid) {
					vscode.postMessage({
						command: 'seleccionarProceso',
						pid: pid
					});
				}
			</script>
		</body>
		</html>
	`;
}

// Función para generar HTML con gráficos de métricas
function getMetricsHTML(pid: number): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
			<style>
				* {
					box-sizing: border-box;
				}
				body {
					padding: 20px;
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					margin: 0;
				}
				h1 {
					color: #4ec9b0;
					margin-bottom: 10px;
				}
				h2 {
					color: #569cd6;
					font-size: 18px;
					margin-top: 30px;
					margin-bottom: 15px;
					border-bottom: 2px solid var(--vscode-panel-border);
					padding-bottom: 5px;
				}
				#status {
					padding: 10px;
					background-color: var(--vscode-textBlockQuote-background);
					border-radius: 5px;
					margin-bottom: 20px;
					font-size: 14px;
				}
				.metrics-grid {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
					gap: 15px;
					margin-bottom: 20px;
				}
				.metric-card {
					background-color: var(--vscode-editor-inactiveSelectionBackground);
					border: 1px solid var(--vscode-panel-border);
					border-radius: 5px;
					padding: 12px 15px;
					transition: all 0.2s;
				}
				.metric-card:hover {
					border-color: #4ec9b0;
					box-shadow: 0 2px 8px rgba(78, 201, 176, 0.2);
				}
				.metric-label {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 5px;
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.metric-name {
					font-weight: 500;
				}
				.metric-unit {
					font-size: 10px;
					opacity: 0.7;
				}
				.metric-value {
					font-size: 24px;
					font-weight: 600;
					color: #4ec9b0;
					font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
				}
				.metric-updated {
					opacity: 0;
					animation: pulse 0.3s ease-in-out;
				}
				@keyframes pulse {
					0%, 100% { opacity: 0; }
					50% { opacity: 1; }
				}
				.no-data {
					color: var(--vscode-disabledForeground);
				}
				.chart-container {
					background-color: var(--vscode-editor-inactiveSelectionBackground);
					border: 1px solid var(--vscode-panel-border);
					border-radius: 5px;
					padding: 20px;
					margin: 20px 0;
					height: 300px;
					position: relative;
				}
				.charts-row {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 20px;
				}
				@media (max-width: 1200px) {
					.charts-row {
						grid-template-columns: 1fr;
					}
				}
				button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 10px 20px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 14px;
					font-family: var(--vscode-font-family);
					transition: background-color 0.2s;
					margin: 10px 0;
				}
				button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				button:active {
					background-color: var(--vscode-button-hoverBackground);
					opacity: 0.8;
				}
			</style>
		</head>
		<body>
			<h1>📊 Métricas en tiempo real - PID ${pid}</h1>
			<button onclick="vscode.postMessage({command: 'backToList'})">← Volver a la lista de procesos</button>
			<div id="status">⏳ Esperando métricas...</div>
			
			<h2>📈 Gráficos en Tiempo Real</h2>
			<div class="charts-row">
				<div class="chart-container">
					<canvas id="cpuChart"></canvas>
				</div>
				<div class="chart-container">
					<canvas id="memoryChart"></canvas>
				</div>
			</div>
			
			<h2>💻 CPU & Performance</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-cpu-usage">
					<div class="metric-label">
						<span class="metric-name">CPU Usage</span>
						<span class="metric-unit">%</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-time-in-jit">
					<div class="metric-label">
						<span class="metric-name">Time in JIT</span>
						<span class="metric-unit">ms</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-methods-jitted-count">
					<div class="metric-label">
						<span class="metric-name">Methods JIT Compiled</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-il-bytes-jitted">
					<div class="metric-label">
						<span class="metric-name">IL Bytes JIT Compiled</span>
						<span class="metric-unit">bytes</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>

			<h2>🧠 Memory</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-working-set">
					<div class="metric-label">
						<span class="metric-name">Working Set</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gc-heap-size">
					<div class="metric-label">
						<span class="metric-name">GC Heap Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gc-committed">
					<div class="metric-label">
						<span class="metric-name">GC Committed</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-alloc-rate">
					<div class="metric-label">
						<span class="metric-name">Allocation Rate</span>
						<span class="metric-unit">bytes/sec</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>

			<h2>🗑️ Garbage Collection</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-gen-0-gc-count">
					<div class="metric-label">
						<span class="metric-name">Gen 0 GC Count</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gen-1-gc-count">
					<div class="metric-label">
						<span class="metric-name">Gen 1 GC Count</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gen-2-gc-count">
					<div class="metric-label">
						<span class="metric-name">Gen 2 GC Count</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-time-in-gc">
					<div class="metric-label">
						<span class="metric-name">Time in GC</span>
						<span class="metric-unit">%</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gc-fragmentation">
					<div class="metric-label">
						<span class="metric-name">GC Fragmentation</span>
						<span class="metric-unit">%</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-total-pause-time-by-gc">
					<div class="metric-label">
						<span class="metric-name">Total Pause Time</span>
						<span class="metric-unit">ms</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>

			<h2>📦 GC Generations Size</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-gen-0-size">
					<div class="metric-label">
						<span class="metric-name">Gen 0 Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gen-1-size">
					<div class="metric-label">
						<span class="metric-name">Gen 1 Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gen-2-size">
					<div class="metric-label">
						<span class="metric-name">Gen 2 Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-loh-size">
					<div class="metric-label">
						<span class="metric-name">LOH Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-poh-size">
					<div class="metric-label">
						<span class="metric-name">POH Size</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-gen-0-gc-budget">
					<div class="metric-label">
						<span class="metric-name">Gen 0 GC Budget</span>
						<span class="metric-unit">MB</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>

			<h2>🧵 Threading</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-threadpool-thread-count">
					<div class="metric-label">
						<span class="metric-name">ThreadPool Threads</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-threadpool-queue-length">
					<div class="metric-label">
						<span class="metric-name">ThreadPool Queue</span>
						<span class="metric-unit">items</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-threadpool-completed-items-count">
					<div class="metric-label">
						<span class="metric-name">ThreadPool Completed</span>
						<span class="metric-unit">items</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-monitor-lock-contention-count">
					<div class="metric-label">
						<span class="metric-name">Lock Contentions</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>

			<h2>⚙️ Runtime</h2>
			<div class="metrics-grid">
				<div class="metric-card" id="card-assembly-count">
					<div class="metric-label">
						<span class="metric-name">Assemblies Loaded</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-active-timer-count">
					<div class="metric-label">
						<span class="metric-name">Active Timers</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
				<div class="metric-card" id="card-exception-count">
					<div class="metric-label">
						<span class="metric-name">Exceptions</span>
						<span class="metric-unit">count</span>
					</div>
					<div class="metric-value no-data">--</div>
				</div>
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				let updateCount = 0;
				let lastUpdateTime = Date.now();
				
				// Configuración de gráficos (viene del servidor)
				const maxDataPoints = ${getConfig().maxDataPoints};
				
				// Configuración de Chart.js para tema oscuro
				const chartOptions = {
					responsive: true,
					maintainAspectRatio: false,
					animation: {
						duration: 300
					},
					scales: {
						x: {
							display: true,
							grid: {
								color: 'rgba(255, 255, 255, 0.1)'
							},
							ticks: {
								color: '#cccccc',
								maxTicksLimit: 10
							}
						},
						y: {
							display: true,
							grid: {
								color: 'rgba(255, 255, 255, 0.1)'
							},
							ticks: {
								color: '#cccccc'
							},
							beginAtZero: true
						}
					},
					plugins: {
						legend: {
							display: true,
							labels: {
								color: '#cccccc'
							}
						}
					}
				};
				
				// Datos para los gráficos
				const cpuData = {
					labels: [],
					values: []
				};
				const memoryData = {
					labels: [],
					values: {
						workingSet: [],
						gcHeap: []
					}
				};
				
				// Crear gráfico de CPU
				const cpuChart = new Chart(document.getElementById('cpuChart'), {
					type: 'line',
					data: {
						labels: cpuData.labels,
						datasets: [{
							label: 'CPU Usage (%)',
							data: cpuData.values,
							borderColor: '#4ec9b0',
							backgroundColor: 'rgba(78, 201, 176, 0.1)',
							borderWidth: 2,
							fill: true,
							tension: 0.4
						}]
					},
					options: {
						...chartOptions,
						scales: {
							...chartOptions.scales,
							y: {
								...chartOptions.scales.y,
								max: 100
							}
						}
					}
				});
				
				// Crear gráfico de Memoria
				const memoryChart = new Chart(document.getElementById('memoryChart'), {
					type: 'line',
					data: {
						labels: memoryData.labels,
						datasets: [
							{
								label: 'Working Set (MB)',
								data: memoryData.values.workingSet,
								borderColor: '#569cd6',
								backgroundColor: 'rgba(86, 156, 214, 0.1)',
								borderWidth: 2,
								fill: true,
								tension: 0.4
							},
							{
								label: 'GC Heap (MB)',
								data: memoryData.values.gcHeap,
								borderColor: '#ce9178',
								backgroundColor: 'rgba(206, 145, 120, 0.1)',
								borderWidth: 2,
								fill: true,
								tension: 0.4
							}
						]
					},
					options: chartOptions
				});
				
				// Función para agregar punto a un gráfico
				function addDataPoint(chart, label, ...values) {
					chart.data.labels.push(label);
					values.forEach((value, index) => {
						chart.data.datasets[index].data.push(value);
					});
					
					// Mantener solo los últimos maxDataPoints
					if (chart.data.labels.length > maxDataPoints) {
						chart.data.labels.shift();
						chart.data.datasets.forEach(dataset => dataset.data.shift());
					}
					
					chart.update('none'); // 'none' para actualización más rápida
				}
				
				// Mapeo de nombres de métricas a IDs de elementos
				const metricMap = {
					'cpu-usage': { id: 'cpu-usage', format: (v) => (v * 100).toFixed(2) },
					'working-set': { id: 'working-set', format: (v) => v.toFixed(2) },
					'gc-heap-size': { id: 'gc-heap-size', format: (v) => v.toFixed(2) },
					'gen-0-gc-count': { id: 'gen-0-gc-count', format: (v) => v.toFixed(0) },
					'gen-1-gc-count': { id: 'gen-1-gc-count', format: (v) => v.toFixed(0) },
					'gen-2-gc-count': { id: 'gen-2-gc-count', format: (v) => v.toFixed(0) },
					'gen-0-gc-budget': { id: 'gen-0-gc-budget', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'threadpool-thread-count': { id: 'threadpool-thread-count', format: (v) => v.toFixed(0) },
					'monitor-lock-contention-count': { id: 'monitor-lock-contention-count', format: (v) => v.toFixed(0) },
					'threadpool-queue-length': { id: 'threadpool-queue-length', format: (v) => v.toFixed(0) },
					'threadpool-completed-items-count': { id: 'threadpool-completed-items-count', format: (v) => v.toFixed(0) },
					'alloc-rate': { id: 'alloc-rate', format: (v) => v.toLocaleString() },
					'active-timer-count': { id: 'active-timer-count', format: (v) => v.toFixed(0) },
					'gc-fragmentation': { id: 'gc-fragmentation', format: (v) => v.toFixed(2) },
					'gc-committed': { id: 'gc-committed', format: (v) => v.toFixed(2) },
					'exception-count': { id: 'exception-count', format: (v) => v.toFixed(0) },
					'time-in-gc': { id: 'time-in-gc', format: (v) => v.toFixed(2) },
					'total-pause-time-by-gc': { id: 'total-pause-time-by-gc', format: (v) => v.toFixed(2) },
					'gen-0-size': { id: 'gen-0-size', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'gen-1-size': { id: 'gen-1-size', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'gen-2-size': { id: 'gen-2-size', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'loh-size': { id: 'loh-size', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'poh-size': { id: 'poh-size', format: (v) => (v / 1024 / 1024).toFixed(2) },
					'assembly-count': { id: 'assembly-count', format: (v) => v.toFixed(0) },
					'il-bytes-jitted': { id: 'il-bytes-jitted', format: (v) => v.toLocaleString() },
					'methods-jitted-count': { id: 'methods-jitted-count', format: (v) => v.toLocaleString() },
					'time-in-jit': { id: 'time-in-jit', format: (v) => v.toFixed(2) }
				};
				
				// Variables temporales para acumular datos de una ronda de métricas
				let currentCpuValue = null;
				let currentWorkingSetValue = null;
				let currentGcHeapValue = null;
				
				const goBack = () => {
					vscode.postMessage({
						command: 'obtenerProcesos'
					});
				}

				// Escuchar métricas de la extensión
				window.addEventListener('message', event => {
					const { command, data } = event.data;
					
					if (command === 'actualizarMetrica') {
						updateCount++;
						const now = Date.now();
						const elapsed = (now - lastUpdateTime) / 1000;
						lastUpdateTime = now;
						
						// Actualizar status
						document.getElementById('status').textContent = 
							\`✅ Recibiendo métricas en tiempo real (Actualizaciones: \${updateCount}, Frecuencia: ~\${elapsed.toFixed(1)}s)\`;
						
						// Actualizar métrica específica
						const metricName = data.name;
						const metricValue = data.value;
						
						// Acumular datos para los gráficos
						if (metricName === 'cpu-usage') {
							currentCpuValue = metricValue * 100; // Convertir a porcentaje
						} else if (metricName === 'working-set') {
							currentWorkingSetValue = metricValue; // Ya viene en MB
						} else if (metricName === 'gc-heap-size') {
							currentGcHeapValue = metricValue; // Ya viene en MB
							
							// Cuando llega gc-heap-size (una de las últimas métricas),
							// actualizamos los gráficos si tenemos todos los datos
							if (currentCpuValue !== null && currentWorkingSetValue !== null && currentGcHeapValue !== null) {
								const timeLabel = new Date().toLocaleTimeString();
								
								// Actualizar gráfico de CPU
								addDataPoint(cpuChart, timeLabel, currentCpuValue);
								
								// Actualizar gráfico de Memoria
								addDataPoint(memoryChart, timeLabel, currentWorkingSetValue, currentGcHeapValue);
								
								// Resetear para la siguiente ronda
								currentCpuValue = null;
								currentWorkingSetValue = null;
								currentGcHeapValue = null;
							}
						}
						
						// Actualizar tarjetas de métricas
						if (metricMap[metricName]) {
							const config = metricMap[metricName];
							const cardElement = document.getElementById('card-' + config.id);
							if (cardElement) {
								const valueElement = cardElement.querySelector('.metric-value');
								if (valueElement) {
									valueElement.textContent = config.format(metricValue);
									valueElement.classList.remove('no-data');
									
									// Animación de actualización
									cardElement.classList.add('metric-updated');
									setTimeout(() => cardElement.classList.remove('metric-updated'), 300);
								}
							}
						}
					}
				});
			</script>
		</body>
		</html>
	`;
}

// This method is called when your extension is deactivated
export function deactivate() {}

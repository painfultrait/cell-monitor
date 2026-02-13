const sql = require('mssql');

interface Cell {
  number: number;
  status: number;
}

interface SavedSettings {
  host: string;
  user: string;
  password: string;
  database: string;
}

let pool: any = null;
let refreshInterval: NodeJS.Timeout | null = null;

let grid: HTMLDivElement;
let connectBtn: HTMLButtonElement;
let disconnectBtn: HTMLButtonElement;
let statusDiv: HTMLDivElement;
let hostInput: HTMLInputElement;
let userInput: HTMLInputElement;
let passwordInput: HTMLInputElement;
let databaseInput: HTMLInputElement;
let saveSettingsCheckbox: HTMLInputElement;
let errorMessage: HTMLDivElement;
let errorText: HTMLDivElement;
let statsDiv: HTMLDivElement;
let totalCellsSpan: HTMLSpanElement;
let freeCellsSpan: HTMLSpanElement;
let occupiedCellsSpan: HTMLSpanElement;

const TABLE_NAME = 'dbo.tb_Cells';
const SETTINGS_KEY = 'cellMonitorSettings';
const SAVE_ENABLED_KEY = 'cellMonitorSaveEnabled';

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM загружен, инициализация...');
  
  grid = document.getElementById('grid') as HTMLDivElement;
  connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
  disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
  statusDiv = document.getElementById('status') as HTMLDivElement;
  hostInput = document.getElementById('host') as HTMLInputElement;
  userInput = document.getElementById('user') as HTMLInputElement;
  passwordInput = document.getElementById('password') as HTMLInputElement;
  databaseInput = document.getElementById('database') as HTMLInputElement;
  saveSettingsCheckbox = document.getElementById('saveSettings') as HTMLInputElement;
  errorMessage = document.getElementById('errorMessage') as HTMLDivElement;
  errorText = document.getElementById('errorText') as HTMLDivElement;
  statsDiv = document.getElementById('stats') as HTMLDivElement;
  totalCellsSpan = document.getElementById('totalCells') as HTMLSpanElement;
  freeCellsSpan = document.getElementById('freeCells') as HTMLSpanElement;
  occupiedCellsSpan = document.getElementById('occupiedCells') as HTMLSpanElement;

  connectBtn.addEventListener('click', connectToDatabase);
  disconnectBtn.addEventListener('click', disconnect);
  
  [hostInput, userInput, passwordInput, databaseInput].forEach(input => {
    input.addEventListener('input', hideError);
  });
  
  saveSettingsCheckbox.addEventListener('change', () => {
    localStorage.setItem(SAVE_ENABLED_KEY, saveSettingsCheckbox.checked.toString());
    if (saveSettingsCheckbox.checked) {
      saveSettings();
    } else {
      localStorage.removeItem(SETTINGS_KEY);
    }
  });
  
  loadSettings();
  
  console.log('Инициализация завершена');
});

function showError(message: string) {
  errorText.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}

function saveSettings() {
  if (!saveSettingsCheckbox.checked) return;
  
  const settings: SavedSettings = {
    host: hostInput.value,
    user: userInput.value,
    password: passwordInput.value,
    database: databaseInput.value,
  };
  
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  console.log('Настройки сохранены');
}

function loadSettings() {
  const saveEnabled = localStorage.getItem(SAVE_ENABLED_KEY) === 'true';
  saveSettingsCheckbox.checked = saveEnabled;
  
  if (saveEnabled) {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const settings: SavedSettings = JSON.parse(saved);
        hostInput.value = settings.host || '';
        userInput.value = settings.user || '';
        passwordInput.value = settings.password || '';
        databaseInput.value = settings.database || '';
        console.log('Настройки загружены');
      } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
      }
    }
  }
}

async function connectToDatabase() {
  console.log('=== Начало подключения ===');
  
  hideError();
  
  connectBtn.disabled = true;
  connectBtn.textContent = 'Подключение...';
  
  try {
    const hostValue = hostInput.value || 'localhost';
    const parts = hostValue.split('\\');
    const server = parts[0];
    const instanceName = parts[1] || undefined;

    console.log('Параметры подключения:', {
      server,
      instanceName,
      database: databaseInput.value,
      user: userInput.value,
    });

    const config = {
      server: server,
      database: databaseInput.value,
      user: userInput.value || 'sa',
      password: passwordInput.value,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        instanceName: instanceName,
      },
    };

    console.log('Попытка подключения...');
    pool = await sql.connect(config);
    console.log('Успешно подключено!');
    
    saveSettings();
    
    statusDiv.textContent = 'Подключено';
    statusDiv.className = 'status connected';
    connectBtn.style.display = 'none';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Подключиться';
    disconnectBtn.style.display = 'inline-block';
    statsDiv.style.display = 'flex';
    
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    tabs[0].classList.add('active');
    tabs[1].classList.remove('active');
    tabContents[0].classList.add('active');
    tabContents[1].classList.remove('active');
    
    console.log('Загрузка ячеек...');
    await loadCells();
    
    console.log('Настройка автообновления...');
    refreshInterval = setInterval(loadCells, 2000);
    
  } catch (error) {
    console.error('Ошибка подключения:', error);
    
    connectBtn.disabled = false;
    connectBtn.textContent = 'Подключиться';
    
    statusDiv.textContent = 'Ошибка подключения';
    statusDiv.className = 'status disconnected';
    
    showError((error as Error).message);
  }
}

async function disconnect() {
  console.log('Отключение...');
  
  hideError();
  
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  
  if (pool) {
    await pool.close();
    pool = null;
  }
  
  statusDiv.textContent = 'Отключено';
  statusDiv.className = 'status disconnected';
  connectBtn.style.display = 'inline-block';
  connectBtn.disabled = false;
  connectBtn.textContent = 'Подключиться';
  disconnectBtn.style.display = 'none';
  statsDiv.style.display = 'none';
  grid.innerHTML = '<div class="loading">Подключитесь к базе данных для просмотра ячеек</div>';
  
  console.log('Отключено');
}

async function loadCells() {
  if (!pool) {
    console.log('Нет подключения к пулу');
    return;
  }
  
  try {
    console.log(`Загрузка ячеек из ${TABLE_NAME}...`);
    
    const result = await pool.request()
      .query(`SELECT Number as number, StatusId as status FROM ${TABLE_NAME} WHERE StatusId != 0`);
    
    console.log(`Загружено ${result.recordset.length} ячеек`);
    
    const cells = result.recordset as Cell[];
    renderCells(cells);
    updateStats(cells);
    
  } catch (error) {
    console.error('Ошибка загрузки:', error);
    statusDiv.textContent = `Ошибка: ${(error as Error).message}`;
    statusDiv.className = 'status disconnected';
  }
}

function updateStats(cells: Cell[]) {
  const total = cells.length;
  const free = cells.filter(c => c.status === 180).length;
  const occupied = cells.filter(c => c.status === 200).length;
  
  console.log('Статистика:', { total, free, occupied });
  
  totalCellsSpan.textContent = total.toString();
  freeCellsSpan.textContent = free.toString();
  occupiedCellsSpan.textContent = occupied.toString();
}

function renderCells(cells: Cell[]) {
  console.log('Отрисовка ячеек...');
  grid.innerHTML = '';
  
  const sortedCells = [...cells].sort((a, b) => a.number - b.number);
  
  sortedCells.forEach(cell => {
    const cellDiv = document.createElement('div');
    
    let cellClass = 'cell ';
    let statusText = '';
    
    if (cell.status === 180) {
      cellClass += 'free';
      statusText = 'СВОБОДНА';
    } else if (cell.status === 200) {
      cellClass += 'occupied';
      statusText = 'ЗАНЯТА';
    } else if (cell.status === 190) {
      cellClass += 'unavailable';
      statusText = 'НЕДОСТУПНА';
    } else if (cell.status === 210) {
      cellClass += 'unavailable';
      statusText = 'ЗАБЛОКИРОВАНА';
    } else {
      cellClass += 'unknown';
      statusText = `СТАТУС ${cell.status}`;
    }
    
    
    cellDiv.className = cellClass;
    
    cellDiv.innerHTML = `
      <div class="cell-number">${cell.number}</div>
      <div class="cell-status">${statusText}</div>
    `;
    
    grid.appendChild(cellDiv);
  });
  
  console.log('Отрисовка завершена');
}
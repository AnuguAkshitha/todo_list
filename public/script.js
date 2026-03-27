let userId = null;
let alarmOsc = null;
let alarmInterval = null;

async function register() {
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPass').value;
  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  alert(data.message);
}

async function login() {
  const email = document.getElementById('logEmail').value;
  const password = document.getElementById('logPass').value;
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.success) {
    userId = true;
    document.getElementById('auth').style.display = 'none';
    document.getElementById('todo').style.display = 'block';
    loadTasks();
    startAlarmCheck();
  } else {
    alert(data.message);
  }
}

async function logout() {
  await fetch('/logout', { method: 'POST', credentials: 'include' });
  document.getElementById('auth').style.display = 'block';
  document.getElementById('todo').style.display = 'none';
  clearInterval(alarmInterval);
  stopAlarm();
}

async function addTask() {
  const text = document.getElementById('taskText').value;
  const date = document.getElementById('taskDate').value;
  if (!text || !date) return alert("Task and date required");

  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text, date })
  });

  document.getElementById('taskText').value = '';
  document.getElementById('taskDate').value = '';
  loadTasks();
}

async function loadTasks() {
  const res = await fetch('/api/tasks', { credentials: 'include' });
  const tasks = await res.json();
  const list = document.getElementById('taskList');
  list.innerHTML = '';

  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = task.done ? 'done' : '';

    const info = document.createElement('div');
    info.className = 'task-info';
    info.textContent = `${task.text} - ${new Date(task.date).toLocaleString()} ${task.done ? '✅' : ''}`;
    li.appendChild(info);

    if (!task.done) {
      // Complete button
      const completeBtn = document.createElement('button');
      completeBtn.textContent = 'Complete';
      completeBtn.className = 'small';
      completeBtn.onclick = () => updateTask(task.id, { done: true });
      li.appendChild(completeBtn);

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.className = 'small';
      editBtn.onclick = () => editTask(task);
      li.appendChild(editBtn);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'small';
      deleteBtn.onclick = () => deleteTask(task.id);
      li.appendChild(deleteBtn);
    }

    list.appendChild(li);
  });
}

async function updateTask(id, data) {
  await fetch(`/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  loadTasks();
}

function editTask(task) {
  const newName = prompt("Edit task name:", task.text);
  const newDate = prompt("Edit date/time (YYYY-MM-DDTHH:MM):", task.date.slice(0,16));
  if (newName && newDate) updateTask(task.id, { text: newName, date: newDate });
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
  loadTasks();
}

// --- Alarm ---
function startAlarmCheck() {
  alarmInterval = setInterval(async () => {
    const res = await fetch('/api/tasks', { credentials: 'include' });
    const tasks = await res.json();
    const now = new Date();
    for (const task of tasks) {
      if (!task.done && new Date(task.date) <= now) {
        playAlarm(task.text);
      }
    }
  }, 1000);
}

function playAlarm(taskName) {
  stopAlarm();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  alarmOsc = audioCtx.createOscillator();
  alarmOsc.type = 'sine';
  alarmOsc.frequency.setValueAtTime(880, audioCtx.currentTime);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  alarmOsc.connect(gain);
  gain.connect(audioCtx.destination);
  alarmOsc.start();

  const utter = new SpeechSynthesisUtterance(`Reminder: ${taskName}`);
  utter.lang = 'en-US';
  speechSynthesis.speak(utter);

  if (!document.getElementById('stopAlarmBtn')) {
    const btn = document.createElement('button');
    btn.id = 'stopAlarmBtn';
    btn.textContent = 'Stop Alarm';
    btn.onclick = stopAlarm;
    document.body.appendChild(btn);
  }
}

function stopAlarm() {
  if (alarmOsc) { alarmOsc.stop(); alarmOsc.disconnect(); alarmOsc = null; }
  speechSynthesis.cancel();
  const btn = document.getElementById('stopAlarmBtn');
  if (btn) btn.remove();
}
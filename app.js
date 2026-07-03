document.addEventListener('DOMContentLoaded', () => {
    // State
    let token = localStorage.getItem('token');
    let chatHistory = [];
    let chartInstance = null;

    // Elements
    const authView = document.getElementById('authView');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const loginForm = document.getElementById('loginForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const navItems = document.querySelectorAll('.nav-item');
    const toastEl = document.getElementById('toast');

    // Init
    if (token) {
        showApp();
    }

    // UI Helpers
    function showToast(msg, type = 'blue') {
        toastEl.textContent = msg;
        toastEl.className = `fixed bottom-5 right-5 glass border-l-4 border-${type}-500 text-white px-6 py-3 rounded shadow-lg transition-all duration-300`;
        toastEl.style.opacity = '1';
        toastEl.style.transform = 'translateY(0)';
        setTimeout(() => {
            toastEl.style.opacity = '0';
            toastEl.style.transform = 'translateY(16px)';
        }, 3000);
    }

    function switchView(targetId) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');
        navItems.forEach(el => el.classList.remove('active'));
        document.querySelector(`[data-target="${targetId}"]`).classList.add('active');

        if (targetId === 'dashboardView') loadDashboard();
        if (targetId === 'productsView') loadProducts();
    }

    function showApp() {
        authView.classList.add('hidden');
        sidebar.classList.remove('hidden-view');
        mainContent.classList.remove('hidden-view');
        loadDashboard();
    }

    // Event Listeners
    navItems.forEach(item => {
        item.addEventListener('click', (e) => switchView(e.currentTarget.dataset.target));
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        location.reload();
    });

    // Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'Authenticating...';
        
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                })
            });
            const data = await res.json();
            
            if (res.ok) {
                token = data.token;
                localStorage.setItem('token', token);
                showToast('Login successful', 'green');
                showApp();
            } else {
                showToast(data.error, 'red');
            }
        } catch (err) {
            showToast('Connection error', 'red');
        } finally {
            btn.textContent = 'Login';
        }
    });

    // Chat
    document.getElementById('chatForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        const msg = input.value.trim();
        if (!msg) return;

        appendMessage('user', msg);
        input.value = '';
        chatHistory.push({ role: 'user', content: msg });

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ message: msg, history: chatHistory.slice(-10) })
            });
            const data = await res.json();
            
            if (res.ok) {
                appendMessage('ai', data.reply);
                chatHistory.push({ role: 'assistant', content: data.reply });
            } else {
                appendMessage('ai', 'Error connecting to AI API.');
            }
        } catch (err) {
            appendMessage('ai', 'Network error.');
        }
    });

    function appendMessage(sender, text) {
        const box = document.getElementById('chatBox');
        const div = document.createElement('div');
        div.className = `flex gap-4 ${sender === 'user' ? 'justify-end' : ''}`;
        
        const innerClass = sender === 'user' 
            ? 'bg-blue-600 p-3 rounded-lg rounded-tr-none max-w-2xl text-sm shadow text-white' 
            : 'bg-modern-700 p-3 rounded-lg rounded-tl-none max-w-2xl text-sm border border-gray-600 shadow';
        
        div.innerHTML = `<div class="${innerClass}">${text}</div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    // Analysis
    document.getElementById('analyzeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('analyzeBtn');
        const text = document.getElementById('transcriptInput').value;
        if (!text) return showToast('Enter transcript', 'yellow');

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        btn.disabled = true;

        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ transcript: text })
            });
            const data = await res.json();
            
            if (res.ok) {
                renderAnalysis(data);
                showToast('Analysis Complete', 'green');
            } else {
                showToast(data.error || 'Analysis failed', 'red');
            }
        } catch (err) {
            showToast('Network error during analysis', 'red');
        } finally {
            btn.innerHTML = '<i class="fas fa-magic"></i> Analyze Call';
            btn.disabled = false;
        }
    });

    function renderAnalysis(data) {
        document.getElementById('analysisResults').classList.remove('hidden');
        
        // Scores
        const scoresHtml = Object.entries(data.scores).map(([key, val]) => `
            <div class="bg-modern-800 p-3 rounded border border-gray-700 text-center">
                <div class="text-xs text-gray-400 uppercase">${key}</div>
                <div class="text-xl font-bold ${val > 80 ? 'text-green-400' : val > 50 ? 'text-yellow-400' : 'text-red-400'}">${val}%</div>
            </div>
        `).join('');
        document.getElementById('scoreCards').innerHTML = scoresHtml;

        // Issues
        const issuesHtml = data.issues.map(iss => `
            <div class="bg-modern-900 p-3 rounded border-l-2 ${iss.risk === 'High' ? 'border-red-500' : 'border-yellow-500'}">
                <p class="text-gray-400 italic">"${iss.quote}"</p>
                <p class="text-white mt-1"><strong>Correction:</strong> ${iss.correction}</p>
                <p class="text-xs text-blue-400 mt-1">${iss.recommendation}</p>
            </div>
        `).join('');
        document.getElementById('issuesList').innerHTML = issuesHtml || 'No major issues detected.';

        // Coaching
        document.getElementById('coachList').innerHTML = `
            <div><strong class="text-green-400">Strengths:</strong> ${data.coaching.strengths.join(', ')}</div>
            <div class="mt-2"><strong class="text-red-400">Weaknesses:</strong> ${data.coaching.weaknesses.join(', ')}</div>
            <div class="mt-2"><strong class="text-blue-400">Tip:</strong> ${data.coaching.tips[0] || 'Keep practicing!'}</div>
        `;

        // Timestamps
        document.getElementById('timelineList').innerHTML = data.timestamps.map(ts => `
            <div class="flex gap-4 border-b border-gray-700 pb-2">
                <span class="font-mono text-blue-400">${ts.time}</span>
                <span>${ts.event}</span>
            </div>
        `).join('');
    }

    // Dashboard Data
    async function loadDashboard() {
        try {
            const res = await fetch('/api/dashboard', { headers: { 'Authorization': `Bearer ${token}` }});
            if (!res.ok) return;
            const data = await res.json();
            
            document.getElementById('dashTotalCalls').textContent = data.totalCalls;
            document.getElementById('dashAvgOverall').textContent = data.avgOverall + '%';
            document.getElementById('dashAvgHonesty').textContent = data.avgHonesty + '%';
            document.getElementById('dashAvgScript').textContent = data.avgScript + '%';

            renderChart();
        } catch (err) {
            console.error('Failed to load dashboard', err);
        }
    }

    function renderChart() {
        const ctx = document.getElementById('performanceChart').getContext('2d');
        if (chartInstance) chartInstance.destroy();
        
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    label: 'Call Volume',
                    data: [12, 19, 15, 25, 22, 10, 5],
                    borderColor: '#3b82f6',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
                },
                plugins: { legend: { labels: { color: '#f8fafc' } } }
            }
        });
    }

    // Products Data
    async function loadProducts() {
        try {
            const res = await fetch('/api/products', { headers: { 'Authorization': `Bearer ${token}` }});
            if (!res.ok) return;
            const data = await res.json();
            
            const html = data.map(p => `
                <div class="glass p-5 rounded-xl border border-gray-700 hover:border-blue-500 transition cursor-default relative overflow-hidden">
                    <div class="absolute top-0 right-0 bg-green-500 text-xs px-2 py-1 rounded-bl text-white shadow">${p.status}</div>
                    <h3 class="text-xl font-bold mb-2">${p.name}</h3>
                    <div class="space-y-2 text-sm text-gray-300">
                        <p><strong class="text-white">Ingredients:</strong> ${p.ingredients}</p>
                        <p><strong class="text-white">Benefits:</strong> ${p.benefits}</p>
                    </div>
                </div>
            `).join('');
            document.getElementById('productsGrid').innerHTML = html;
        } catch (err) {
            console.error('Failed to load products', err);
        }
    }
});

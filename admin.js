const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// --- Auth Middleware ---
const requireAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'fallback_secret_key');
        req.adminId = decoded.id;
        next();
    } catch (e) {
        res.status(401).json({ error: "Invalid token" });
    }
};

// --- Admin APIs ---
router.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const AdminUser = mongoose.model('AdminUser');
        const user = await AdminUser.findOne({ username, isActive: true });
        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });
        
        const token = jwt.sign({ id: user._id }, process.env.SESSION_SECRET || 'fallback_secret_key', { expiresIn: '1d' });
        res.cookie('admin_token', token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.post('/api/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true });
});

router.get('/api/check', requireAdmin, (req, res) => {
    res.json({ success: true });
});

router.get('/api/dashboard', requireAdmin, async (req, res) => {
    try {
        const Appointment = mongoose.model('Appointment');
        const ContactMessage = mongoose.model('ContactMessage');
        const today = new Date().toISOString().split('T')[0];
        
        const [total, pending, confirmed, completed, cancelled, todayAppts, recent] = await Promise.all([
            Appointment.countDocuments(),
            Appointment.countDocuments({ status: 'Pending' }),
            Appointment.countDocuments({ status: 'Confirmed' }),
            Appointment.countDocuments({ status: 'Completed' }),
            Appointment.countDocuments({ status: 'Cancelled' }),
            Appointment.countDocuments({ appointmentDate: today }),
            Appointment.find().sort({ createdAt: -1 }).limit(10).populate('serviceId', 'name').populate('dentistId', 'name')
        ]);
        
        const unreadMsgs = await ContactMessage.countDocuments({ isRead: false });

        res.json({ stats: { total, pending, confirmed, completed, cancelled, todayAppts, unreadMsgs }, recent });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.get('/api/appointments', requireAdmin, async (req, res) => {
    try {
        const Appointment = mongoose.model('Appointment');
        const appointments = await Appointment.find()
            .sort({ appointmentDate: -1, startTime: -1 })
            .populate('serviceId', 'name')
            .populate('dentistId', 'name');
        res.json(appointments);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.patch('/api/appointments/:id/status', requireAdmin, async (req, res) => {
    try {
        const Appointment = mongoose.model('Appointment');
        const { status } = req.body;
        await Appointment.findByIdAndUpdate(req.params.id, { status });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.get('/api/services', requireAdmin, async (req, res) => {
    try {
        const Service = mongoose.model('Service');
        const services = await Service.find().sort('displayOrder');
        res.json(services);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.post('/api/services', requireAdmin, async (req, res) => {
    try {
        const Service = mongoose.model('Service');
        const srv = new Service(req.body);
        await srv.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.get('/api/messages', requireAdmin, async (req, res) => {
    try {
        const ContactMessage = mongoose.model('ContactMessage');
        const messages = await ContactMessage.find().sort({ createdAt: -1 });
        res.json(messages);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// --- Admin UI ---
const getAdminHTML = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - DentalCare</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --primary: #6C8CFF; --primary-hover: #5671CC; --bg: #F4F7FE; 
            --surface: #FFFFFF; --text-main: #25304A; --text-sec: #68738B;
            --success: #16845B; --warning: #d9822b; --error: #C43D50; --border: #e0e5f0;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: var(--bg); color: var(--text-main); }
        
        .clay-card {
            background: var(--surface); border-radius: 24px;
            box-shadow: 8px 8px 16px #e0e5f0, -8px -8px 16px #ffffff;
            padding: 24px;
        }
        .clay-btn {
            background: var(--primary); color: white; border: none;
            padding: 10px 20px; border-radius: 12px; font-weight: 600;
            cursor: pointer; transition: 0.2s; font-family: inherit;
        }
        .clay-btn:hover { background: var(--primary-hover); }
        .clay-input {
            width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 12px;
            margin-bottom: 16px; font-family: inherit; outline: none; background: #fafcff;
        }
        .clay-input:focus { border-color: var(--primary); }
        
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { padding: 16px; text-align: left; border-bottom: 1px solid var(--border); }
        th { color: var(--text-sec); font-weight: 600; }
        tr:last-child td { border-bottom: none; }
        
        .badge { padding: 6px 12px; border-radius: 50px; font-size: 12px; font-weight: 600; display: inline-block; }
        .badge.pending { background: #fff0c2; color: var(--warning); }
        .badge.confirmed { background: #dcebff; color: var(--primary); }
        .badge.completed { background: #b8f2d8; color: var(--success); }
        .badge.cancelled { background: #ffd8d8; color: var(--error); }
        
        /* Layouts */
        #login-view { display: flex; align-items: center; justify-content: center; height: 100vh; }
        #app-view { display: none; height: 100vh; overflow: hidden; }
        
        .sidebar { width: 260px; background: var(--surface); padding: 24px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
        .sidebar .logo { font-size: 20px; font-weight: 700; color: var(--primary); margin-bottom: 32px; display: flex; align-items: center; gap: 8px; }
        .nav-item { padding: 12px 16px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--text-sec); font-weight: 600; transition: 0.2s; }
        .nav-item:hover, .nav-item.active { background: var(--primary); color: white; }
        
        .main-content { flex: 1; padding: 32px; overflow-y: auto; }
        .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px; }
        .stat-card { display: flex; flex-direction: column; gap: 8px; }
        .stat-val { font-size: 32px; font-weight: 700; color: var(--primary); }
        
        .toast { position: fixed; top: 20px; right: 20px; padding: 16px 24px; background: white; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); z-index: 2000; display: none; }
    </style>
</head>
<body>
    <div id="toast" class="toast"></div>

    <div id="login-view">
        <div class="clay-card" style="width: 400px; text-align: center;">
            <div style="color: var(--primary); margin-bottom: 24px; display: flex; justify-content: center;"><i data-lucide="shield" style="width: 48px; height: 48px;"></i></div>
            <h2 style="margin-bottom: 24px;">Admin Portal</h2>
            <form id="login-form">
                <input type="text" id="username" class="clay-input" placeholder="Username" required>
                <input type="password" id="password" class="clay-input" placeholder="Password" required>
                <button type="submit" class="clay-btn" style="width: 100%;">Secure Login</button>
            </form>
        </div>
    </div>

    <div id="app-view" style="display: none;">
        <div class="sidebar">
            <div class="logo"><i data-lucide="smile"></i> DentalCare Hub</div>
            <div class="nav-item active" onclick="nav('dashboard')"><i data-lucide="layout-dashboard"></i> Dashboard</div>
            <div class="nav-item" onclick="nav('appointments')"><i data-lucide="calendar"></i> Appointments</div>
            <div class="nav-item" onclick="nav('services')"><i data-lucide="list"></i> Services</div>
            <div class="nav-item" onclick="nav('messages')"><i data-lucide="mail"></i> Messages</div>
            <div style="flex: 1;"></div>
            <div class="nav-item" onclick="logout()"><i data-lucide="log-out"></i> Logout</div>
        </div>
        <div class="main-content" id="main-content">
            <!-- Dynamic content -->
        </div>
    </div>

    <script>
        lucide.createIcons();
        
        const showToast = (msg) => {
            const t = document.getElementById('toast');
            t.textContent = msg; t.style.display = 'block';
            setTimeout(() => t.style.display = 'none', 3000);
        };

        const apiCall = async (url, options={}) => {
            const res = await fetch(url, options);
            if(res.status === 401) { showLogin(); throw new Error('Unauthorized'); }
            return res.json();
        };

        // Auth Logic
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const res = await fetch('/admin/api/login', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        username: document.getElementById('username').value,
                        password: document.getElementById('password').value
                    })
                });
                const data = await res.json();
                if(data.success) { initApp(); } else { showToast(data.error); }
            } catch(e) { showToast('Login failed'); }
        });

        async function logout() {
            await fetch('/admin/api/logout', {method: 'POST'});
            showLogin();
        }

        function showLogin() {
            document.getElementById('app-view').style.display = 'none';
            document.getElementById('login-view').style.display = 'flex';
        }

        // Routing & Views
        let currentView = 'dashboard';
        async function nav(view) {
            currentView = view;
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            event.currentTarget.classList.add('active');
            renderView();
        }

        async function initApp() {
            try {
                const check = await apiCall('/admin/api/check');
                if(check.success) {
                    document.getElementById('login-view').style.display = 'none';
                    document.getElementById('app-view').style.display = 'flex';
                    renderView();
                }
            } catch(e) {}
        }

        async function renderView() {
            const content = document.getElementById('main-content');
            content.innerHTML = '<p>Loading...</p>';
            
            try {
                if(currentView === 'dashboard') {
                    const data = await apiCall('/admin/api/dashboard');
                    content.innerHTML = \`
                        <div class="header-row"><h2>Dashboard Overview</h2></div>
                        <div class="stats-grid">
                            <div class="clay-card stat-card"><span style="color: var(--text-sec)">Today's Appts</span><span class="stat-val">\${data.stats.todayAppts}</span></div>
                            <div class="clay-card stat-card"><span style="color: var(--text-sec)">Pending Appts</span><span class="stat-val">\${data.stats.pending}</span></div>
                            <div class="clay-card stat-card"><span style="color: var(--text-sec)">Total Confirmed</span><span class="stat-val">\${data.stats.confirmed}</span></div>
                            <div class="clay-card stat-card"><span style="color: var(--text-sec)">Unread Messages</span><span class="stat-val">\${data.stats.unreadMsgs}</span></div>
                        </div>
                        <div class="clay-card">
                            <h3>Recent Appointments</h3>
                            <table>
                                <thead><tr><th>Ref</th><th>Patient</th><th>Date & Time</th><th>Status</th></tr></thead>
                                <tbody>
                                    \${data.recent.map(a => \`
                                        <tr>
                                            <td>\${a.bookingReference}</td>
                                            <td>\${a.patientName}</td>
                                            <td>\${a.appointmentDate} <br><span style="font-size:12px;color:var(--text-sec)">\${a.startTime}</span></td>
                                            <td><span class="badge \${a.status.toLowerCase()}">\${a.status}</span></td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                }
                else if(currentView === 'appointments') {
                    const data = await apiCall('/admin/api/appointments');
                    content.innerHTML = \`
                        <div class="header-row"><h2>Manage Appointments</h2></div>
                        <div class="clay-card">
                            <table>
                                <thead><tr><th>Ref</th><th>Patient</th><th>Service</th><th>Date & Time</th><th>Status</th><th>Actions</th></tr></thead>
                                <tbody>
                                    \${data.map(a => \`
                                        <tr>
                                            <td><strong>\${a.bookingReference}</strong></td>
                                            <td>\${a.patientName}<br><span style="font-size:12px;color:var(--text-sec)">\${a.phone}</span></td>
                                            <td>\${a.serviceId?.name || 'N/A'}</td>
                                            <td>\${a.appointmentDate} at \${a.startTime}</td>
                                            <td><span class="badge \${a.status.toLowerCase()}">\${a.status}</span></td>
                                            <td>
                                                <select onchange="updateStatus('\${a._id}', this.value)" style="padding:4px; border-radius:4px;">
                                                    <option value="" disabled selected>Change Status</option>
                                                    <option value="Confirmed">Confirm</option>
                                                    <option value="Completed">Complete</option>
                                                    <option value="Cancelled">Cancel</option>
                                                </select>
                                            </td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                }
                else if(currentView === 'services') {
                    const data = await apiCall('/admin/api/services');
                    content.innerHTML = \`
                        <div class="header-row"><h2>Services Directory</h2></div>
                        <div class="clay-card">
                            <table>
                                <thead><tr><th>Name</th><th>Price (₹)</th><th>Status</th></tr></thead>
                                <tbody>
                                    \${data.map(s => \`
                                        <tr>
                                            <td>\${s.name}</td>
                                            <td>₹\${s.price}</td>
                                            <td><span class="badge \${s.isActive ? 'completed' : 'cancelled'}">\${s.isActive ? 'Active' : 'Inactive'}</span></td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                }
                else if(currentView === 'messages') {
                    const data = await apiCall('/admin/api/messages');
                    content.innerHTML = \`
                        <div class="header-row"><h2>Contact Inquiries</h2></div>
                        <div class="clay-card">
                            <table>
                                <thead><tr><th>Name</th><th>Email</th><th>Message</th><th>Date</th></tr></thead>
                                <tbody>
                                    \${data.map(m => \`
                                        <tr>
                                            <td>\${m.name}</td>
                                            <td>\${m.email}</td>
                                            <td style="max-width: 300px;">\${m.message}</td>
                                            <td>\${new Date(m.createdAt).toLocaleDateString()}</td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                }
            } catch(e) { content.innerHTML = '<p>Error loading view.</p>'; }
            lucide.createIcons();
        }

        window.updateStatus = async (id, status) => {
            if(!status) return;
            try {
                await apiCall(\`/admin/api/appointments/\${id}/status\`, {
                    method: 'PATCH', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({status})
                });
                showToast('Status updated');
                renderView();
            } catch(e) { showToast('Update failed'); }
        };

        // Start
        initApp();
    </script>
</body>
</html>`;

router.get('/', (req, res) => {
    res.send(getAdminHTML());
});

module.exports = router;

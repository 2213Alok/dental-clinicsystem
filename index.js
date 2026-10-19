require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const app = express();

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for inline scripts/styles in this architecture
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: "Too many requests." });
app.use('/api/', apiLimiter);

// --- Database Connection (Serverless optimized) ---
let cachedDb = null;
async function connectDB() {
    if (cachedDb) return cachedDb;
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI is missing.");
        return null;
    }
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        cachedDb = conn;
        console.log("MongoDB Connected");
        return conn;
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
        throw err;
    }
}

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'admin' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

const serviceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    price: Number,
    durationMinutes: { type: Number, default: 30 },
    icon: String,
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 }
}, { timestamps: true });

const dentistSchema = new mongoose.Schema({
    name: { type: String, required: true },
    qualification: String,
    specialization: String,
    biography: String,
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

const appointmentSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    patientName: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    dentistId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dentist' },
    appointmentDate: { type: String, required: true }, // Format YYYY-MM-DD
    startTime: { type: String, required: true }, // Format HH:MM
    status: { type: String, enum: ['Pending', 'Confirmed', 'Completed', 'Cancelled'], default: 'Pending' },
    patientNote: String,
    adminNote: String
}, { timestamps: true });
// Prevent double booking at the database level
appointmentSchema.index({ dentistId: 1, appointmentDate: 1, startTime: 1 }, { unique: true });

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false }
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({
    clinicName: { type: String, default: "DentalCare Smile Studio" },
    tagline: { type: String, default: "Your Smile, Our Passion" },
    phone: { type: String, default: "+91 90000 12345" },
    email: { type: String, default: "hello@dentalcare-demo.example" },
    address: { type: String, default: "24 Harmony Avenue, Gomti Nagar, Lucknow, Uttar Pradesh, India" },
    workingHours: { type: String, default: "9:00 AM–7:00 PM" },
    consultationFee: { type: Number, default: 500 }
}, { timestamps: true });

const AdminUser = mongoose.model('AdminUser', userSchema);
const Service = mongoose.model('Service', serviceSchema);
const Dentist = mongoose.model('Dentist', dentistSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const ContactMessage = mongoose.model('ContactMessage', messageSchema);
const ClinicSettings = mongoose.model('ClinicSettings', settingsSchema);

// --- Database Seeding ---
async function seedDatabase() {
    try {
        const adminCount = await AdminUser.countDocuments();
        if (adminCount === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
            const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
            await AdminUser.create({ username: process.env.ADMIN_USERNAME, passwordHash: hash });
        }
        
        const settingsCount = await ClinicSettings.countDocuments();
        if (settingsCount === 0) await ClinicSettings.create({});

        const dentistCount = await Dentist.countDocuments();
        let defaultDentist;
        if (dentistCount === 0) {
            defaultDentist = await Dentist.create({
                name: "Dr. Aanya Sharma",
                qualification: "BDS, MDS (Illustrative)",
                specialization: "General Dentistry",
                biography: "Passionate about providing gentle, pain-free dental care. Over 10 years of experience."
            });
        }

        const servicesCount = await Service.countDocuments();
        if (servicesCount === 0) {
            await Service.insertMany([
                { name: "General Checkup", description: "Comprehensive examination.", price: 500, icon: "stethoscope", displayOrder: 1 },
                { name: "Teeth Cleaning", description: "Professional plaque removal.", price: 1200, icon: "sparkles", displayOrder: 2 },
                { name: "Teeth Whitening", description: "Brighten your smile.", price: 3500, icon: "sun", displayOrder: 3 },
                { name: "Root Canal", description: "Save infected teeth.", price: 4500, icon: "activity", displayOrder: 4 },
                { name: "Braces Consultation", description: "Orthodontic evaluation.", price: 800, icon: "smile", displayOrder: 5 },
                { name: "Implants Consultation", description: "Tooth replacement options.", price: 1000, icon: "layers", displayOrder: 6 },
                { name: "Pediatric Dentistry", description: "Gentle care for kids.", price: 700, icon: "baby", displayOrder: 7 },
                { name: "Cosmetic Dentistry", description: "Aesthetic improvements.", price: 800, icon: "star", displayOrder: 8 }
            ]);
        }
    } catch (e) {
        console.error("Seeding error", e);
    }
}

// Connect and seed on cold start
connectDB().then(seedDatabase);

// --- Public API Routes ---
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await ClinicSettings.findOne() || {};
        res.json(settings);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/services', async (req, res) => {
    try {
        const services = await Service.find({ isActive: true }).sort('displayOrder');
        res.json(services);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/dentists', async (req, res) => {
    try {
        const dentists = await Dentist.find({ isActive: true });
        res.json(dentists);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/availability', async (req, res) => {
    try {
        const { date, dentistId } = req.query;
        if (!date || !dentistId) return res.status(400).json({ error: "Date and Dentist ID required" });
        
        const dayOfWeek = new Date(date).getDay();
        if (dayOfWeek === 0) return res.json([]); // Closed Sunday
        
        // Generate 9:00 AM to 6:30 PM slots
        const allSlots = [];
        for (let h = 9; h <= 18; h++) {
            allSlots.push(`${h.toString().padStart(2, '0')}:00`);
            allSlots.push(`${h.toString().padStart(2, '0')}:30`);
        }
        
        const booked = await Appointment.find({
            dentistId,
            appointmentDate: date,
            status: { $nin: ['Cancelled'] }
        }).select('startTime');
        
        const bookedSet = new Set(booked.map(b => b.startTime));
        const available = allSlots.filter(s => !bookedSet.has(s));
        res.json(available);
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/appointments', async (req, res) => {
    try {
        const { patientName, phone, email, serviceId, dentistId, appointmentDate, startTime, patientNote } = req.body;
        if (!patientName || !phone || !serviceId || !dentistId || !appointmentDate || !startTime) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        
        const dayOfWeek = new Date(appointmentDate).getDay();
        if (dayOfWeek === 0) return res.status(400).json({ error: "Clinic is closed on Sundays" });
        
        // Check availability logic again just in case
        const existing = await Appointment.findOne({ dentistId, appointmentDate, startTime, status: { $nin: ['Cancelled'] } });
        if (existing) return res.status(400).json({ error: "Slot no longer available" });
        
        const bookingReference = 'DC' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const appointment = new Appointment({
            bookingReference, patientName, phone, email, serviceId, dentistId, appointmentDate, startTime, patientNote
        });
        
        await appointment.save(); // Unique index handles concurrency
        res.json({ success: true, bookingReference });
    } catch (e) {
        if (e.code === 11000) return res.status(400).json({ error: "Slot no longer available (concurrent booking)" });
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, phone, message } = req.body;
        if (!name || !email || !message) return res.status(400).json({ error: "Missing fields" });
        await ContactMessage.create({ name, email, phone, message });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// --- Mount Admin Routes ---
const adminRouter = require('./admin');
app.use('/admin', adminRouter);

// --- Public UI ---
const getPublicHTML = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DentalCare - Smile With Confidence</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --primary: #6C8CFF; --primary-hover: #5671CC; --sky: #DCEBFF; --mint: #B8F2D8;
            --aqua: #B7F0F2; --lavender: #E6D9FF; --peach: #FFD8C2; --cream: #FFF9F0;
            --text-main: #25304A; --text-sec: #68738B; --bg: #F8FAFF;
            --success: #16845B; --error: #C43D50;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: var(--bg); color: var(--text-main); line-height: 1.6; overflow-x: hidden; }
        h1, h2, h3 { font-family: 'DM Sans', sans-serif; font-weight: 700; }
        a { text-decoration: none; color: inherit; }
        
        /* Claymorphism Utils */
        .clay-card {
            background: #ffffff; border-radius: 28px;
            box-shadow: 12px 12px 24px #e4eaf5, -12px -12px 24px #ffffff, inset 2px 2px 4px rgba(255,255,255,0.8);
            transition: transform 0.3s ease;
        }
        .clay-card:hover { transform: translateY(-5px); }
        
        .clay-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            background: var(--primary); color: white; border: none;
            padding: 14px 28px; border-radius: 50px; font-weight: 600; font-family: inherit;
            cursor: pointer; transition: all 0.2s ease;
            box-shadow: 6px 6px 12px #d0d7e6, inset 2px 2px 4px rgba(255,255,255,0.3);
        }
        .clay-btn:hover { background: var(--primary-hover); transform: scale(1.02); }
        .clay-btn.secondary { background: var(--peach); color: var(--text-main); }
        .clay-btn:disabled { opacity: 0.7; cursor: not-allowed; }
        
        .clay-input {
            width: 100%; padding: 14px 20px; border: none; border-radius: 16px;
            background: var(--bg); color: var(--text-main); font-family: inherit;
            box-shadow: inset 4px 4px 8px #e4eaf5, inset -4px -4px 8px #ffffff;
            outline: none; margin-bottom: 16px; transition: box-shadow 0.2s;
        }
        .clay-input:focus { box-shadow: inset 6px 6px 10px #d0d7e6, inset -6px -6px 10px #ffffff, 0 0 0 3px var(--sky); }

        /* Layout */
        .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
        section { padding: 80px 0; }
        
        /* Nav */
        nav { position: sticky; top: 0; background: rgba(248, 250, 255, 0.9); backdrop-filter: blur(10px); z-index: 1000; padding: 16px 0; }
        .nav-content { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 24px; font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 8px; }
        .nav-links { display: flex; gap: 24px; align-items: center; }
        .nav-links a { font-weight: 500; transition: color 0.2s; }
        .nav-links a:hover { color: var(--primary); }
        
        /* Hero */
        .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; min-height: 80vh; padding-top: 40px; }
        .hero-text h1 { font-size: 56px; line-height: 1.1; margin-bottom: 24px; }
        .hero-text p { font-size: 18px; color: var(--text-sec); margin-bottom: 32px; }
        .hero-img-box { position: relative; }
        .hero-img-box img { width: 100%; border-radius: 40px; object-fit: cover; aspect-ratio: 4/3; }
        .floating-badge { position: absolute; background: white; padding: 12px 20px; border-radius: 20px; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); animation: float 6s ease-in-out infinite; font-weight: 600; }
        .badge-1 { top: 20px; left: -30px; animation-delay: 0s; }
        .badge-2 { bottom: 40px; right: -20px; animation-delay: 2s; }
        
        /* Trust Indicators */
        .trust-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; margin-top: -40px; position: relative; z-index: 10; }
        .trust-card { padding: 32px 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .trust-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 8px; }
        .trust-card:nth-child(1) .trust-icon { background: var(--sky); color: var(--primary); }
        .trust-card:nth-child(2) .trust-icon { background: var(--mint); color: var(--success); }
        .trust-card:nth-child(3) .trust-icon { background: var(--peach); color: #d96f32; }
        .trust-card:nth-child(4) .trust-icon { background: var(--lavender); color: #8e63e6; }
        
        /* Services */
        .section-header { text-align: center; margin-bottom: 48px; }
        .services-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
        .service-card { padding: 32px; display: flex; flex-direction: column; height: 100%; }
        .service-icon { width: 48px; height: 48px; background: var(--sky); color: var(--primary); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
        .service-price { font-weight: 800; color: var(--primary); font-size: 20px; margin: 16px 0; }
        .service-card .clay-btn { margin-top: auto; }
        
        /* Booking Section */
        .booking-section { background: var(--cream); border-radius: 40px; padding: 60px; display: grid; grid-template-columns: 1fr 1.5fr; gap: 48px; }
        .booking-form { padding: 40px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .full-width { grid-column: 1 / -1; }
        .slot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 8px; margin-bottom: 16px; }
        .slot-btn { padding: 10px; text-align: center; border-radius: 12px; cursor: pointer; border: 2px solid transparent; background: var(--bg); transition: 0.2s; }
        .slot-btn:hover { background: var(--sky); }
        .slot-btn.selected { background: var(--primary); color: white; border-color: var(--primary); }
        .slot-btn.disabled { opacity: 0.5; cursor: not-allowed; text-decoration: line-through; }
        
        /* Footer */
        footer { background: var(--text-main); color: white; padding: 60px 0 24px; border-top-left-radius: 40px; border-top-right-radius: 40px; }
        .footer-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 40px; margin-bottom: 40px; }
        .footer-grid h3 { margin-bottom: 20px; color: var(--mint); }
        .footer-links li { margin-bottom: 12px; color: #aab4cc; list-style: none; }
        
        /* Animations & Utils */
        @keyframes float { 0% { transform: translateY(0); } 50% { transform: translateY(-10px); } 100% { transform: translateY(0); } }
        .fade-up { opacity: 0; transform: translateY(30px); transition: 0.8s ease; }
        .fade-up.visible { opacity: 1; transform: translateY(0); }
        .toast { position: fixed; bottom: 20px; right: 20px; padding: 16px 24px; background: white; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); z-index: 2000; display: none; align-items: center; gap: 12px; }
        .toast.success { border-left: 6px solid var(--success); }
        .toast.error { border-left: 6px solid var(--error); }
        
        @media (max-width: 768px) {
            .hero, .booking-section, .footer-grid { grid-template-columns: 1fr; }
            .trust-grid { grid-template-columns: 1fr 1fr; }
            .nav-links { display: none; } /* Simplified mobile for demo */
            .form-grid { grid-template-columns: 1fr; }
            .slot-grid { grid-template-columns: repeat(3, 1fr); }
            .booking-section { padding: 30px; border-radius: 20px; }
        }
    </style>
</head>
<body>
    <nav>
        <div class="container nav-content">
            <div class="logo"><i data-lucide="smile"></i> DentalCare</div>
            <div class="nav-links">
                <a href="#about">About</a>
                <a href="#services">Services</a>
                <a href="#dentist">Our Dentist</a>
                <a href="#contact">Contact</a>
                <a href="#book" class="clay-btn" style="padding: 10px 20px;">Book Now</a>
            </div>
        </div>
    </nav>

    <header class="container section">
        <div class="hero">
            <div class="hero-text fade-up">
                <span style="color: var(--primary); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Your Partner in Healthy Smiles</span>
                <h1 id="hero-title">A Healthier Smile Starts Here.</h1>
                <p>Experience personalized, gentle dental care in a modern and relaxing environment. We prioritize your comfort and well-being above all else.</p>
                <div style="display: flex; gap: 16px;">
                    <a href="#book" class="clay-btn">Book an Appointment</a>
                    <a href="#services" class="clay-btn secondary">Explore Services</a>
                </div>
            </div>
            <div class="hero-img-box fade-up" style="transition-delay: 0.2s;">
                <img src="https://images.unsplash.com/photo-1606811841689-23dfddce3e95?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80" alt="Smiling patient at clinic">
                <div class="floating-badge badge-1"><i data-lucide="shield-check" style="color: var(--success)"></i> Gentle Care</div>
                <div class="floating-badge badge-2"><i data-lucide="heart" style="color: #d96f32"></i> Personalized</div>
            </div>
        </div>
    </header>

    <section class="container" style="padding-top: 0;">
        <div class="trust-grid fade-up">
            <div class="clay-card trust-card">
                <div class="trust-icon"><i data-lucide="users"></i></div>
                <h3>Expert Team</h3>
                <p style="font-size: 14px; color: var(--text-sec)">Experienced dental professionals (Demo)</p>
            </div>
            <div class="clay-card trust-card">
                <div class="trust-icon"><i data-lucide="monitor"></i></div>
                <h3>Modern Tech</h3>
                <p style="font-size: 14px; color: var(--text-sec)">Latest equipment for precision</p>
            </div>
            <div class="clay-card trust-card">
                <div class="trust-icon"><i data-lucide="clipboard-list"></i></div>
                <h3>Tailored Plans</h3>
                <p style="font-size: 14px; color: var(--text-sec)">Customized treatments for you</p>
            </div>
            <div class="clay-card trust-card">
                <div class="trust-icon"><i data-lucide="sofa"></i></div>
                <h3>Comfort First</h3>
                <p style="font-size: 14px; color: var(--text-sec)">Relaxing patient experience</p>
            </div>
        </div>
    </section>

    <section id="services" class="container">
        <div class="section-header fade-up">
            <h2>Our Dental Services</h2>
            <p style="color: var(--text-sec); margin-top: 8px;">Comprehensive care for your whole family</p>
        </div>
        <div class="services-grid fade-up" id="services-container">
            <!-- Populated via JS -->
        </div>
    </section>

    <section id="book" class="container">
        <div class="booking-section clay-card fade-up">
            <div>
                <h2 style="font-size: 40px; margin-bottom: 24px;">Book Your Visit</h2>
                <p style="color: var(--text-sec); margin-bottom: 32px;">Schedule your appointment easily online. Select a service, date, and time that works best for you.</p>
                <div style="display: flex; gap: 16px; margin-bottom: 24px;">
                    <div style="width: 48px; height: 48px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--primary);"><i data-lucide="calendar-check"></i></div>
                    <div>
                        <h4 style="font-family: 'DM Sans'">Real-time Availability</h4>
                        <p style="font-size: 14px; color: var(--text-sec)">Secure your exact slot instantly.</p>
                    </div>
                </div>
            </div>
            <div class="clay-card booking-form">
                <form id="appointment-form">
                    <div class="form-grid">
                        <input type="text" id="b-name" class="clay-input" placeholder="Full Name" required>
                        <input type="tel" id="b-phone" class="clay-input" placeholder="Phone Number" required pattern="^[0-9+\\\\-\\\\s]{10,15}$" title="Enter a valid phone number">
                        <input type="email" id="b-email" class="clay-input full-width" placeholder="Email Address (Optional)">
                        
                        <select id="b-dentist" class="clay-input full-width" required>
                            <option value="">Select Dentist</option>
                        </select>
                        
                        <select id="b-service" class="clay-input full-width" required>
                            <option value="">Select Service</option>
                        </select>
                        
                        <input type="date" id="b-date" class="clay-input full-width" required>
                        
                        <div class="full-width">
                            <label style="font-weight: 600; font-size: 14px; color: var(--text-sec);">Available Time</label>
                            <div class="slot-grid" id="slot-container">
                                <p style="grid-column: 1/-1; font-size: 14px; color: #888;">Please select a date and dentist first.</p>
                            </div>
                            <input type="hidden" id="b-time" required>
                        </div>
                        
                        <textarea id="b-note" class="clay-input full-width" placeholder="Any special notes?" rows="2"></textarea>
                        
                        <label class="full-width" style="display: flex; gap: 12px; font-size: 14px; cursor: pointer; align-items: flex-start;">
                            <input type="checkbox" required style="margin-top: 4px;">
                            <span>I consent to the clinic's terms and acknowledge this is a demo booking request.</span>
                        </label>
                        
                        <button type="submit" class="clay-btn full-width" id="b-submit">Confirm Appointment</button>
                    </div>
                </form>
                <div id="booking-success" style="display: none; text-align: center; padding: 40px 0;">
                    <div style="width: 80px; height: 80px; background: var(--mint); color: var(--success); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 40px;"><i data-lucide="check-circle" style="width: 48px; height: 48px;"></i></div>
                    <h3 style="font-size: 28px; margin-bottom: 12px;">Booking Confirmed!</h3>
                    <p style="color: var(--text-sec); margin-bottom: 24px;">Your reference: <strong id="ref-number" style="color: var(--text-main); font-size: 20px;"></strong></p>
                    <button type="button" class="clay-btn secondary" onclick="location.reload()">Book Another</button>
                </div>
            </div>
        </div>
    </section>

    <section id="contact" class="container">
        <div class="section-header fade-up">
            <h2>Contact & Visit Us</h2>
        </div>
        <div class="hero">
            <div class="clay-card fade-up" style="padding: 40px;">
                <h3 style="margin-bottom: 24px;">Send us a message</h3>
                <form id="contact-form">
                    <input type="text" id="c-name" class="clay-input" placeholder="Your Name" required>
                    <input type="email" id="c-email" class="clay-input" placeholder="Your Email" required>
                    <textarea id="c-msg" class="clay-input" placeholder="How can we help?" rows="4" required></textarea>
                    <button type="submit" class="clay-btn" id="c-submit">Send Message</button>
                </form>
            </div>
            <div class="fade-up" style="padding-left: 20px;">
                <h3 style="margin-bottom: 24px;">Clinic Information</h3>
                <p style="margin-bottom: 16px; display: flex; gap: 12px;"><i data-lucide="map-pin" style="color: var(--primary)"></i> <span id="info-address">Loading...</span></p>
                <p style="margin-bottom: 16px; display: flex; gap: 12px;"><i data-lucide="phone" style="color: var(--primary)"></i> <span id="info-phone">Loading...</span></p>
                <p style="margin-bottom: 16px; display: flex; gap: 12px;"><i data-lucide="mail" style="color: var(--primary)"></i> <span id="info-email">Loading...</span></p>
                <p style="margin-bottom: 24px; display: flex; gap: 12px;"><i data-lucide="clock" style="color: var(--primary)"></i> <span id="info-hours">Loading...</span></p>
                <p style="font-size: 14px; color: var(--error);">* Note: This is illustrative demo data.</p>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-grid">
                <div>
                    <h2 style="font-size: 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="smile"></i> DentalCare</h2>
                    <p style="color: #aab4cc;" id="info-tagline">Your Smile, Our Passion</p>
                </div>
                <div>
                    <h3>Quick Links</h3>
                    <ul class="footer-links">
                        <li><a href="#about">About Us</a></li>
                        <li><a href="#services">Services</a></li>
                        <li><a href="#dentist">Our Dentist</a></li>
                    </ul>
                </div>
                <div>
                    <h3>Legal</h3>
                    <ul class="footer-links">
                        <li>Privacy Policy</li>
                        <li>Terms & Conditions</li>
                        <li>Demo Disclaimer</li>
                    </ul>
                </div>
                <div>
                    <h3>Admin</h3>
                    <ul class="footer-links">
                        <li><a href="/admin">Admin Login</a></li>
                    </ul>
                </div>
            </div>
            <div style="text-align: center; color: #68738B; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
                &copy; <span id="year"></span> DentalCare Demo System. All rights reserved. Built for Vercel.
            </div>
        </div>
    </footer>

    <div id="toast" class="toast">
        <i data-lucide="info"></i> <span id="toast-msg"></span>
    </div>

    <script>
        lucide.createIcons();
        document.getElementById('year').textContent = new Date().getFullYear();
        
        // Animations
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if(entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

        // State
        let servicesData = [];
        
        // Utils
        const showToast = (msg, type='success') => {
            const t = document.getElementById('toast');
            document.getElementById('toast-msg').textContent = msg;
            t.className = \`toast \${type}\`;
            t.style.display = 'flex';
            setTimeout(() => t.style.display = 'none', 3000);
        };

        // Fetch Data
        async function initData() {
            try {
                const [setRes, srvRes, denRes] = await Promise.all([
                    fetch('/api/settings'), fetch('/api/services'), fetch('/api/dentists')
                ]);
                const settings = await setRes.json();
                servicesData = await srvRes.json();
                const dentists = await denRes.json();

                // Populate Settings
                if(settings.heroTitle) document.getElementById('hero-title').textContent = settings.heroTitle;
                document.getElementById('info-address').textContent = settings.address || '';
                document.getElementById('info-phone').textContent = settings.phone || '';
                document.getElementById('info-email').textContent = settings.email || '';
                document.getElementById('info-hours').textContent = settings.workingHours || '';
                document.getElementById('info-tagline').textContent = settings.tagline || '';

                // Populate Services
                const srvCont = document.getElementById('services-container');
                const srvSelect = document.getElementById('b-service');
                srvCont.innerHTML = servicesData.map(s => \`
                    <div class="clay-card service-card">
                        <div class="service-icon"><i data-lucide="\${s.icon || 'star'}"></i></div>
                        <h3>\${s.name}</h3>
                        <p style="color: var(--text-sec); font-size: 14px; flex-grow: 1;">\${s.description}</p>
                        <div class="service-price">₹\${s.price}</div>
                        <button class="clay-btn secondary" onclick="selectService('\${s._id}')" style="width: 100%;">Book Service</button>
                    </div>
                \`).join('');
                
                servicesData.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s._id; opt.textContent = \`\${s.name} (₹\${s.price})\`;
                    srvSelect.appendChild(opt);
                });

                // Populate Dentists
                const denSelect = document.getElementById('b-dentist');
                dentists.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d._id; opt.textContent = d.name;
                    denSelect.appendChild(opt);
                });
                if(dentists.length > 0) denSelect.value = dentists[0]._id;

                lucide.createIcons();
                
                // Set min date
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('b-date').min = today;
            } catch(e) { console.error("Error loading data", e); }
        }

        window.selectService = (id) => {
            document.getElementById('b-service').value = id;
            document.getElementById('book').scrollIntoView({behavior: 'smooth'});
        };

        // Booking Logic
        const dateInput = document.getElementById('b-date');
        const dentistInput = document.getElementById('b-dentist');
        const slotContainer = document.getElementById('slot-container');
        const timeInput = document.getElementById('b-time');

        async function fetchSlots() {
            const date = dateInput.value;
            const dentist = dentistInput.value;
            if(!date || !dentist) return;
            
            slotContainer.innerHTML = '<p style="grid-column: 1/-1;">Loading slots...</p>';
            timeInput.value = '';
            
            try {
                const res = await fetch(\`/api/availability?date=\${date}&dentistId=\${dentist}\`);
                const slots = await res.json();
                
                if(slots.error) {
                    slotContainer.innerHTML = \`<p style="grid-column: 1/-1; color: var(--error);">\${slots.error}</p>\`;
                    return;
                }
                if(slots.length === 0) {
                    slotContainer.innerHTML = '<p style="grid-column: 1/-1; color: var(--error);">No slots available on this date.</p>';
                    return;
                }
                
                slotContainer.innerHTML = slots.map(s => \`
                    <div class="slot-btn" onclick="selectSlot('\${s}', this)">\${s}</div>
                \`).join('');
            } catch(e) {
                slotContainer.innerHTML = '<p style="grid-column: 1/-1; color: var(--error);">Failed to load slots.</p>';
            }
        }

        window.selectSlot = (time, el) => {
            document.querySelectorAll('.slot-btn').forEach(btn => btn.classList.remove('selected'));
            el.classList.add('selected');
            timeInput.value = time;
        };

        dateInput.addEventListener('change', fetchSlots);
        dentistInput.addEventListener('change', fetchSlots);

        document.getElementById('appointment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if(!timeInput.value) return showToast('Please select a time slot', 'error');
            
            const btn = document.getElementById('b-submit');
            btn.disabled = true; btn.textContent = 'Processing...';
            
            const payload = {
                patientName: document.getElementById('b-name').value,
                phone: document.getElementById('b-phone').value,
                email: document.getElementById('b-email').value,
                dentistId: dentistInput.value,
                serviceId: document.getElementById('b-service').value,
                appointmentDate: dateInput.value,
                startTime: timeInput.value,
                patientNote: document.getElementById('b-note').value
            };

            try {
                const res = await fetch('/api/appointments', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                
                if(!res.ok) throw new Error(data.error || 'Booking failed');
                
                document.getElementById('appointment-form').style.display = 'none';
                document.getElementById('booking-success').style.display = 'block';
                document.getElementById('ref-number').textContent = data.bookingReference;
            } catch(e) {
                showToast(e.message, 'error');
                btn.disabled = false; btn.textContent = 'Confirm Appointment';
                fetchSlots(); // Refresh slots in case of collision
            }
        });

        // Contact Logic
        document.getElementById('contact-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('c-submit');
            btn.disabled = true; btn.textContent = 'Sending...';
            try {
                const res = await fetch('/api/contact', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('c-name').value,
                        email: document.getElementById('c-email').value,
                        message: document.getElementById('c-msg').value
                    })
                });
                if(!res.ok) throw new Error();
                showToast('Message sent successfully!');
                e.target.reset();
            } catch(e) { showToast('Failed to send message', 'error'); }
            finally { btn.disabled = false; btn.textContent = 'Send Message'; }
        });

        initData();
    </script>
</body>
</html>`;

app.get('/', (req, res) => {
    res.send(getPublicHTML());
});

// Final export for Vercel
module.exports = app;
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server running locally on port 3000'));
}

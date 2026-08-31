const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'maa_jaya_buildcon';
const ROOT = __dirname;
const sessions = new Map();

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable.');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error('Missing ADMIN_PASSWORD environment variable.');
  process.exit(1);
}

const mongoClient = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
});
let enquiries;
let mongoReady = false;

async function connectDatabase() {
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);
  enquiries = db.collection('enquiries');
  await enquiries.createIndex({ createdAt: -1 });
  await enquiries.createIndex({ status: 1, createdAt: -1 });
  mongoReady = true;
  console.log(`MongoDB connected: ${MONGODB_DB}.enquiries`);
}

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(ROOT));

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: mongoReady, service: 'Maa Jaya Buildcon API', database: mongoReady ? 'connected' : 'disconnected' });
});

app.post('/api/enquiries', async (req, res) => {
  try {
    const { name, phone, service, message } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });

    const enquiry = {
      id: crypto.randomUUID(),
      name: String(name).trim().slice(0, 100),
      phone: String(phone).trim().slice(0, 40),
      service: String(service || 'General').trim().slice(0, 100),
      message: String(message || '').trim().slice(0, 2000),
      status: 'New',
      createdAt: new Date(),
    };

    await enquiries.insertOne(enquiry);
    res.status(201).json({ success: true, enquiry: { id: enquiry.id } });
  } catch (error) {
    console.error('Create enquiry error:', error);
    res.status(500).json({ error: 'Unable to save enquiry.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now());
  res.json({ success: true, token });
});

app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  try {
    const items = await enquiries.find({}).sort({ createdAt: -1 }).toArray();
    res.json({ enquiries: items });
  } catch (error) {
    console.error('Read enquiries error:', error);
    res.status(500).json({ error: 'Unable to load enquiries.' });
  }
});

app.patch('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    const allowed = ['New', 'Contacted', 'In Progress', 'Completed'];
    const { status } = req.body || {};
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const updatedAt = new Date();
    const result = await enquiries.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status, updatedAt } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Enquiry not found' });
    res.json({ success: true, enquiry: result });
  } catch (error) {
    console.error('Update enquiry error:', error);
    res.status(500).json({ error: 'Unable to update enquiry.' });
  }
});

app.delete('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    const result = await enquiries.deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Enquiry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete enquiry error:', error);
    res.status(500).json({ error: 'Unable to delete enquiry.' });
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  res.sendFile(path.join(ROOT, 'index.html'));
});

async function start() {
  try {
    await connectDatabase();
    app.listen(PORT, () => console.log(`Maa Jaya Buildcon running on http://localhost:${PORT}`));
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await mongoClient.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await mongoClient.close();
  process.exit(0);
});

start();

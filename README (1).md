# ⚡ Bitcoin Ekasi — Diploma Attendance Tracker

> Rewarding education with real Bitcoin, one sat at a time.

![Bitcoin Ekasi](https://img.shields.io/badge/Bitcoin-Ekasi-f7931a?style=for-the-badge&logo=bitcoin&logoColor=white)
![Lightning Network](https://img.shields.io/badge/Lightning-Network-ffd700?style=for-the-badge&logo=lightning&logoColor=black)
![Made in South Africa](https://img.shields.io/badge/Made%20in-South%20Africa%20🇿🇦-007A4D?style=for-the-badge)

---

## 🌍 About

**Bitcoin Ekasi** is a Bitcoin-focused community organization based in **Mossel Bay, South Africa**. We run a **Bitcoin Diploma Program** that teaches students about Bitcoin and the Lightning Network — and we put our money where our mouth is by paying students in real sats for showing up.

This tracker is the operational backbone of that program.

---

## 🎯 What It Does

Every day a student attends class, their teacher marks them present. At the end of the session, **500 sats are automatically sent to their Lightning wallet** via the Blink API — no spreadsheets, no cash, no delays.

### For Teachers
- Mark daily attendance with a single tap
- View which students are owed sats
- Trigger Lightning payouts directly from the dashboard
- Manage their own student roster and Lightning addresses

### For Admins
- Oversee all teachers, classes, and students in one portal
- View live attendance stats across the entire program
- Export reports to Excel for record keeping
- Manage Blink API credentials and system settings

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — single file, no build step |
| Database | Supabase (PostgreSQL) |
| Payments | Blink API (Lightning Network) |
| Backend | Node.js on Render |
| Auth | Simple password-based, stored in localStorage |
| Export | SheetJS (Excel export) |

---

## ⚡ How Payouts Work

1. Teacher marks students present for the day
2. Admin or teacher opens the **Payouts** panel
3. Each student's outstanding sats balance is shown alongside their **Lightning Address**
4. Click **Pay All Outstanding** — the backend calls the Blink API and sends sats directly to each student's wallet
5. Student receives real Bitcoin on their phone instantly

> 500 sats per day attended. Simple, transparent, verifiable on-chain.

---

## 🚀 Getting Started

### Prerequisites
- A [Blink](https://blink.sv) account with API key (READ + WRITE)
- A [Supabase](https://supabase.com) project with the schema below
- A [Render](https://render.com) account to host the backend

### Database Schema (Supabase)

```sql
-- Teachers
create table teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  class_name text not null,
  created_at timestamptz default now()
);

-- Students
create table students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id),
  name text not null,
  lightning_address text not null,
  paid int default 0,
  created_at timestamptz default now()
);

-- Attendance
create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  date date not null,
  created_at timestamptz default now(),
  unique(student_id, date)
);
```

### Configuration

In the tracker's **Settings** page:
- Paste your **Blink API key** (READ + WRITE)
- Click **Save Settings**
- Click **Test Blink Connection** to verify

---

## 📁 Project Structure

```
bitcoin-ekasi/
├── ekasi-tracker.html     # Full frontend (single file)
├── backend/
│   ├── index.js           # Express server — proxies Blink API
│   └── package.json
└── README.md
```

---

## 🙏 Mission

Bitcoin Ekasi exists to bring Bitcoin to township communities in South Africa — not as speculation, but as **real, everyday money**. The Diploma Program is how we educate the next generation of Bitcoiners, and this tracker makes sure every student who shows up gets rewarded in the hardest money on earth.

> *"Not your keys, not your coins — but first, you have to understand why."*

---

## 📬 Contact

- 🌐 [bitcoinekasi.com](https://bitcoinekasi.com)
- 🐦 Twitter/X: [@BitcoinEkasi](https://twitter.com/BitcoinEkasi)
- 📍 Mossel Bay, Western Cape, South Africa 🇿🇦

---

<p align="center">Built with ⚡ and ₿ in South Africa</p>

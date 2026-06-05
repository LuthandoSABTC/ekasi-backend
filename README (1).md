 Bitcoin Ekasi Diploma Tracker

A Lightning Network-powered attendance and payment system for the Bitcoin Ekasi Bitcoin Diploma Program in Mossel Bay, South Africa.

## What It Does

Students attend Bitcoin education classes and earn **500 sats per day** via the Lightning Network. Teachers mark attendance on their portal and pay students directly to their Bolt Cards or Blink wallets with one click.

### Admin Portal
- View all teachers and their classes in real time
- Mark attendance and send Lightning payments
- Live leaderboard showing top attending students
- Manage student roster
- Configure Blink API key and passwords
- Export attendance data to Excel

### Teacher Portal
- Mark student attendance daily
- Send Lightning payouts to students
- View class statistics and leaderboard
- Enroll and manage students
- Test payment connectivity

## How Payments Work

Each student receives **500 sats per day** they attend class. Payments are sent via the Blink Lightning wallet API directly to:
- **Bolt Card LNURL** (NFC cards linked to Lightning wallets)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript |
| Database | Supabase (PostgreSQL) |
| Payments | Blink API (Lightning Network) |
| Backend | Node.js / Express on Render |
| Admin Hosting | GitHub Pages |
| Teacher Hosting | Vercel |

## Live Apps

- **Admin Portal:** https://luthandosabtc.github.io/bitcoinekasi/
- **Teacher Portal:** https://bitcoinekasi.vercel.app/sassa.html
- **Backend API:** https://ekasi-backend.onrender.com

## Database Schema

```
teachers    - id, name, class_name, password, created_at
students    - id, teacher_id, name, destination, paid, created_at
attendance  - id, student_id, date, created_at
```

## About Bitcoin Ekasi

Bitcoin Ekasi is a Bitcoin education organization based in Mossel Bay, South Africa. The program teaches communities about Bitcoin and the Lightning Network through hands-on learning, rewarding students with real sats for showing up and engaging.

"Teaching Bitcoin by using Bitcoin."

## Built With

- Claude AI (Anthropic) - assisted development
- Lightning Network - instant, low-fee payments
- Blink - Lightning wallet and API
- Supabase - real-time database
- Bolt Cards - NFC Lightning payment cards

---

Built with love for the Bitcoin Ekasi community in Mossel Bay, South Africa.

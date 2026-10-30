# Arsitektur & Integrasi Backend Firebase SIAC-BK

Mengintegrasikan autentikasi Google Firebase dan penyimpanan real-time Cloud Firestore ke dalam aplikasi Sistem Informasi Administrasi & Catatan BK (SIAC-BK) tanpa merubah layout atau alur kerja UI/UX yang sudah ada, serta mengoptimalkan skema data untuk skala besar.

## User Review & Critical Decisions

> [!IMPORTANT]
> Konfirmasi preferensi dan keputusan kritis dari sesi tanya jawab sebelumnya:

- **Mode Autentikasi**: Mode akun tunggal administrator utama (Guru BK / Pengelola BK dengan akun Google `avebungentana@gmail.com`).
- **Penempatan UI Login & Sinkronisasi**: Ditempatkan di header atas sebelah kanan (di samping avatar Guru BK), menyatu secara estetis dan tidak mengganggu komponen fungsional yang sudah ada.
- **Strategi Migrasi Data Lokal**: Menyediakan tombol mandiri "Migrasi / Unggah Data Lokal ke Cloud" di menu Pengaturan agar data yang sudah pernah diinput pengguna dapat disinkronkan ke Firestore secara aman tanpa risiko tertimpa.

---

## 1. Overview & Core Concept

- **Fungsi Utama**: Menyediakan penyimpanan berbasis cloud Firestore real-time berkecepatan tinggi dan otentikasi Google Firebase untuk aplikasi SIAC-BK. Memungkinkan sinkronisasi instan data siswa, rekam jejak poin pelanggaran/prestasi, buku kasus konseling, dan pengaturan sekolah antar-perangkat (PC, laptop guru, tablet).
- **Target Pengguna**: Guru Bimbingan Konseling (BK) dan staf administrasi sekolah.
- **Nilai Tambah**: Data tidak lagi hanya bergantung pada `localStorage` browser yang rentan hilang jika cache dibersihkan atau perangkat berganti; kini tersimpan aman di cloud dengan performa query optimal dan dukungan offline persistence.

---

## 2. User Experience & Minimal UI Adjustments

Sesuai instruksi pengguna: **tidak ada fitur UI/UX yang diubah kecuali yang berkaitan langsung dengan autentikasi dan status database**.

### Tampilan & Interaksi yang Ditambahkan:
1. **Header Kanan Atas**:
   - Status sinkronisasi cloud real-time: Badge indikator halus `Tersambung / Menyinkronkan / Offline`.
   - Tombol Google Sign-In / Sign-Out minimalis dengan info avatar & email akun administrator.
2. **Menu Pengaturan (Settings Tab)**:
   - Tambahan seksi kartu "Integrasi Cloud Firestore":
     - Tombol "Unggah Data Lokal ke Cloud Firestore" (untuk memindahkan data yang saat ini ada di browser).
     - Tombol "Unduh Ulang Data dari Cloud".
3. **Semua Fitur Asli Tetap Utuh 100%**:
   - Dashboard & Analitik (Statistik, Tren Kategori Top 5 Pelanggaran, Donut Chart Layanan, Alert Monitoring Skor Kritis/Bahaya/Waspada).
   - Data Siswa (Tabel, Pencarian, Filter Kelas, Input Siswa, Edit Siswa, Unggah Foto Siswa, Rekam Jejak Detail Siswa, Cetak Surat Panggilan, Cetak PDF Riwayat).
   - Buku Kasus & Konseling (Pencatatan sesi, status kasus, filter tanggal & status, ekspor Excel XLSX).
   - Sistem Poin (Input pelanggaran/prestasi, hitung kalkulasi skor otomatis, tambah & hapus kategori).
   - Fitur Ekspor/Impor Excel & Backup JSON.

---

## 3. Strategi Desain Database Skala Besar (Cloud Firestore)

Untuk memastikan performa tetap cepat pada sekolah dengan ribuan siswa dan puluhan ribu catatan kasus tanpa melebihi batas 1MB per dokumen atau memperlambat pembacaan:

1. **Struktur Sub-Koleksi untuk Riwayat Poin**:
   - `students/{studentId}`: Menyimpan profil dasar siswa, NISN, kelas, dan skor agregat terkini.
   - `students/{studentId}/points/{pointId}`: Riwayat poin disimpan dalam sub-koleksi individual (bukan array raksasa di dalam dokumen siswa). Ini menjamin dokumen siswa tidak meledak ukurannya dan query timeline per siswa sangat cepat.
2. **Koleksi Konseling Terindeks (`counseling/{counselingId}`)**:
   - Dokumen mandiri dengan field `studentId`, `studentName`, `studentClass`, `date`, `type`, `status`.
   - Memungkinkan filter gabungan (kelas, rentang tanggal, status) dengan paginasi dan limit yang hemat kuota.
3. **Koleksi Konfigurasi Sekolah & Kategori Poin**:
   - `config/school`: Menyimpan identitas sekolah, nama guru, skor awal, dan batas alert.
   - `categories/{categoryId}`: Daftar aturan pelanggaran dan prestasi yang dinamis.
4. **Pencegahan Redundant Read (Cache & Snapshot Management)**:
   - Menggunakan listener `onSnapshot` yang efisien dan hanya aktif saat pengguna terautentikasi.
   - Menangani error Firestore dengan format baku `handleFirestoreError`.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SIAC-BK Frontend                                │
│    ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────┐ │
│    │  Dashboard   │  Data Siswa  │  Buku Kasus  │ Sistem Poin  │Settings  │ │
│    └───────┬──────┴───────┬──────┴───────┬──────┴───────┬──────┴─────┬────┘ │
│            │              │              │              │            │      │
│            ▼              ▼              ▼              ▼            ▼      │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │            Firebase Context & Real-Time Data Layer              │     │
│     │   - Google Auth State (Admin verification)                      │     │
│     │   - Real-time Subscriptions (Students, Points, Counseling, Config)│   │
│     │   - LocalStorage Fallback & Migration Utility                   │     │
│     └────────────────────────────────┬────────────────────────────────┘     │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Google Cloud / Firebase                            │
│  ┌───────────────────────┐              ┌────────────────────────────────┐  │
│  │     Firebase Auth     │              │        Cloud Firestore         │  │
│  │ (Google OAuth Login)  │              │  ├─ admins/{uid}               │  │
│  └───────────────────────┘              │  ├─ config/school              │  │
│                                         │  ├─ categories/{categoryId}    │  │
│                                         │  ├─ students/{studentId}       │  │
│                                         │  │    └─ points/{pointId}      │  │
│                                         │  └─ counseling/{counselingId}  │  │
│                                         └────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Firestore ABAC Security Rules                     │  │
│  │  - Admin verification against /admins/{uid}                           │  │
│  │  - Strict schema, key validation, and size constraints                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Rencana Tahapan Eksekusi

1. **Langkah 1: Setup & Provisi Firebase**:
   - Menjalankan `show_aistudio_ui` dengan `ui_type: "firebase_setup"` untuk verifikasi izin akun.
   - Setelah konfirmasi pengguna, menjalankan RPC `ProvisionFirebase` untuk mengaktifkan Firebase Authentication dan Cloud Firestore.
   - Menginstal package `firebase` dan `@firebase/eslint-plugin-security-rules`.
2. **Langkah 2: Definisi Blueprint Data & Aturan Keamanan (Security Rules)**:
   - Membuat `firebase-blueprint.json` yang mendefinisikan entitas (`school`, `category`, `student`, `pointRecord`, `counselingRecord`).
   - Membuat `security_spec.md` dan `firestore.rules` berstandar ABAC Zero-Trust dengan validasi tipe data, ukuran, dan otorisasi admin (`avebungentana@gmail.com`).
   - Melakukan deployment security rules menggunakan RPC `DeployRules`.
3. **Langkah 3: Integrasi Kode Sumber & Komponen React**:
   - Menyiapkan modul koneksi Firebase (`src/firebase.ts`) dengan verifikasi koneksi `getDocFromServer`.
   - Mengonversi kode aplikasi SIAC-BK yang ada di attachment ke komponen React TypeScript modular yang rapi tanpa mengubah satupun estetika desain, tombol, maupun fitur cetak/ekspor.
   - Menghubungkan seluruh aksi (tambah siswa, edit nilai, input poin pelanggaran, buat konseling) langsung ke Cloud Firestore dengan update state real-time.
   - Menambahkan tombol migrasi data lokal di menu Pengaturan.
4. **Langkah 4: Validasi & Kompilasi**:
   - Menjalankan `npm run lint` dan `compile_applet` untuk memastikan seluruh tipe data dan kode TypeScript terkompilasi sempurna tanpa kesalahan.

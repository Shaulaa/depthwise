# Depthwise

Dunia 3D interaktif di browser: lima pulau terapung di atas laut awan, satu kapal udara buat pindah antar pulau, dan empat permainan kecil. Menangkan tiap permainan buat mengumpulkan cap di buku cap, lalu pulang ke pelabuhan buat lihat perayaannya.

Dibangun dengan Three.js, GSAP, TypeScript, dan Vite. Semua model, tekstur, dan suara dibuat lewat kode, jadi repo ini tidak membawa file aset 3D atau audio sama sekali.

## Menjalankan

Butuh Node.js 20.19 ke atas, atau 22.12 ke atas (syarat dari Vite 8).

```bash
npm install
npm run dev        # server pengembangan di http://localhost:5173
```

Perintah lain:

| Perintah | Fungsi |
| --- | --- |
| `npm run build` | Cek tipe, lalu build produksi ke `dist/` |
| `npm run preview` | Menyajikan hasil build secara lokal |
| `npm run typecheck` | Cek tipe TypeScript saja |
| `npm test` | Tes unit (Vitest) |

Build memakai `base: './'`, jadi isi `dist/` bisa langsung ditaruh di sub-path seperti GitHub Pages (`/depthwise/`).

## Cara main

Setelah menekan **Mulai berlayar**, kapal udara langsung lo kemudikan sendiri. Dekati pulau mana pun, lalu tekan `E` buat singgah. Di pulau, lo turun dari kapal sebagai karakter dan jalan kaki ke titik bercahaya keemasan buat mulai main.

| Aksi | Di kapal | Di pulau (jalan kaki) |
| --- | --- | --- |
| Gerak | `W` `S` maju / mundur, `A` `D` belok | `W` `A` `S` `D` jalan, searah kamera |
| `Spasi` | naik | lompat |
| `Shift` | turun | lari |
| `E` atau `Enter` | singgah di pulau terdekat | main di titik bercahaya, atau naik kapal di ujung dermaga |
| `Esc` | — | langsung naik kapal dan lepas landas |
| Seret / gulir | lihat sekeliling, dekat / jauh | lihat sekeliling, dekat / jauh |

Tombol panah bisa dipakai seperti `WASD`. `M` membuka peta (klik pulau buat terbang otomatis, `Esc` buat kembali), dan `T` mengganti waktu (pagi, siang, senja, malam). Daftar tombol muncul sebentar di kiri bawah tiap kali kontrolnya berganti.

Di layar sentuh ada joystick di kiri bawah. Tombol di kanan bawah dipakai buat naik / turun di kapal, dan buat lompat di pulau.

## Pulau dan permainannya

| Kode | Pulau | Permainan |
| --- | --- | --- |
| LBF | Labuan Fajar | Pelabuhan awal. Mercusuarnya menyala penuh setelah semua cap terkumpul. |
| UBN | Pulau Ubin | **Ubin Geser**: puzzle geser 3×3. Klik ubin atau pakai tombol panah. |
| RMB | Rimba Kunang | **Kristal Kunang**: cari enam kristal tersembunyi sambil memutar kamera. |
| TJA | Tanjung Angin | **Balap Cincin**: kemudikan kapal melewati cincin dengan mouse, sentuhan, atau WASD. |
| BKL | Bukit Lentera | **Nyanyian Lentera**: ulangi urutan nyala lentera. Klik lenteranya atau tekan 1 sampai 5. |

## Warga, bulu angin, dan kostum

- **Warga pulau.** Enam warga tinggal di kepulauan: Pak Bayu dan Laras di Labuan Fajar, lalu satu warga di tiap pulau lain. Mereka jalan-jalan santai, menoleh kalau didekati, dan bisa diajak ngobrol dengan `E`. Isi obrolannya mengikuti progresmu, misalnya rekor permainan atau jumlah bulu yang terkumpul.
- **Bulu angin.** Tiap pulau menyimpan tiga bulu angin (15 total). Satu di antaranya melayang agak tinggi, jadi perlu lompat buat mengambilnya.
- **Kostum.** Tiap cap membuka satu warna jaket dan syal baru, dan kostum Bulu Angin terbuka setelah semua bulu terkumpul. Ganti kostum lewat buku cap.
- **Penunjuk arah.** Kalau titik main di luar layar, muncul penunjuk arah di tepi layar lengkap dengan jaraknya.
- **Musik.** Musik latar berganti nuansa mengikuti pulau terdekat.

Progres (cap, rekor, bulu angin, kostum, pengaturan suara) disimpan di `localStorage` browser dan bisa dihapus dari buku cap.

## Struktur kode

```
src/
  main.ts            titik masuk: font, gaya, dan App
  App.ts             alur antar mode (judul, peta, perjalanan, pulau, permainan) dan loop render
  content.ts         teks dan data pulau
  core/              kamera, input, siklus siang-malam, audio, penyimpanan, util matematika
  world/             generator pulau, properti, kapal udara, langit, air, awan, efek
  games/             empat permainan dan logika puzzle
  ui/                semua elemen DOM di luar canvas
tests/               tes unit untuk logika murni
```

Beberapa catatan teknis:

- **Pulau** dibentuk dari fungsi ketinggian analitik (`world/Island.ts`), jadi properti bisa ditaruh tepat di permukaan tanpa raycast.
- **Pohon, rumput, batu, dan awan** memakai `InstancedMesh`. Bangunan tiap pulau digabung jadi beberapa mesh saja.
- **Air** dan **langit** adalah shader sendiri yang warnanya mengikuti siklus siang-malam.
- **Terbang bebas** (`world/Flight.ts`) memberi kapal inersia dan menahannya keluar dari pulau, mercusuar, dan pulau kecil. Rute otomatis dari peta adalah `CatmullRomCurve3` yang dijalankan GSAP.
- **Jalan kaki** (`world/Walk.ts`) memakai tinggi tanah analitik pulau, ditambah lingkaran rintangan (rumah, pohon, tiang) dan lantai datar (dermaga, pelataran ubin). Karakternya (`world/Character.ts`) dirakit dari bentuk dasar dan dianimasikan lewat kode. Kapal jadi tembus pandang kalau menghalangi kamera.
- **Warga** (`world/Npc.ts`) memakai `Character` dan `Walker` yang sama dengan pemain, jadi mereka juga menghindari rumah dan pohon. Dialog dan data kostum ada di `content.ts`.
- **Kamera jalan kaki** maju ke depan pohon atau bangunan yang menghalangi karakter, lalu mundur pelan setelah pandangan bersih.
- **Pemuatan:** Three.js dan GSAP dipisah ke chunk `vendor` supaya tetap ter-cache antar deploy, sedangkan tiap permainan mini baru diunduh waktu dimainkan (atau saat karakter berdiri di titik mainnya).
- **Audio** disintesis dengan Web Audio API (`core/AudioEngine.ts`).
- Resolusi render turun otomatis kalau frame rate tidak terkejar.

## Pintasan pengembangan

Parameter URL ini membantu saat mengerjakan satu bagian:

- `?island=ubin` memulai di pulau tertentu (`hub`, `ubin`, `rimba`, `angin`, `lentera`)
- `?time=0.8` mengunci waktu (0 tengah malam, 0.5 siang)
- `?autostart` melewati layar judul

Di mode pengembangan, instance aplikasi tersedia di konsol sebagai `window.depthwise`.

## Kredit

Dibuat oleh Rafif Shula Syandana. Font: Shippori Mincho dan Figtree (SIL Open Font License), dipaketkan lewat Fontsource.

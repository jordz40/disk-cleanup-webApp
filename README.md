# File Checker

Aplikasi lokal untuk memeriksa isi disk, menemukan file terbesar, lalu menghapus file yang kamu checklist sendiri. Berjalan di browser lewat server Node.js kecil, tanpa dependency dan tanpa koneksi internet.

## Cara menjalankan

1. Pastikan Node.js sudah terpasang (versi 18.15 atau lebih baru).
2. Klik dua kali `start.bat`, atau jalankan `node server.js` di folder ini.
3. Browser terbuka otomatis di `http://localhost:4321`.
4. Tekan **Pindai**. Secara default yang dipindai adalah `C:\` dengan file minimal 10 MB.

Hentikan aplikasi dengan menutup jendela terminal atau `Ctrl+C`.

## Cara pakai

- **Urutkan** dengan klik judul kolom Ukuran, Nama, Kategori, atau Diubah.
- **Filter** berdasarkan kategori, status, atau kata kunci nama/lokasi file.
- **Checklist** file yang ingin dihapus. Total ukuran terpilih muncul di bawah.
- Klik **Hapus terpilih**, lalu pilih metode: Recycle Bin (bisa dipulihkan) atau hapus permanen.
- Tab **Folder terbesar** menunjukkan folder mana yang paling banyak memakan ruang.
- Tab **Aplikasi terinstal** menampilkan aplikasi dari registry Windows (Program & Features) beserta ukuran, publisher, versi, dan tanggal terpasang. Klik **Uninstall** untuk membuka uninstaller resmi aplikasi tersebut.

## Aplikasi terinstal

- Daftar dibaca dari registry Windows, sama seperti daftar di Settings > Apps.
- **Ukuran** memakai nilai `EstimatedSize` yang dicatat installer. Sebagian aplikasi tidak mencatat ukurannya dan akan tampil `—`.
- **Uninstall** membuka uninstaller bawaan aplikasi di jendela terpisah, jadi kamu tetap bisa membatalkan prosesnya. Beberapa aplikasi meminta izin Administrator.
- Perintah uninstaller ditampilkan di dialog konfirmasi sebelum dijalankan.
- Setelah uninstaller selesai, klik **Muat ulang** untuk memperbarui daftar (daftar juga dimuat ulang otomatis beberapa detik kemudian).

## Arti warna

| Tampilan | Arti |
| --- | --- |
| Abu-abu, checkbox mati | File/folder sistem atau file yang sedang dipakai. Tidak bisa dihapus dari aplikasi ini. |
| Kuning "Hati-hati" | Masih bisa dihapus, tapi berisi data pribadi, data aplikasi, atau installer. Periksa dulu. |
| Hijau "Saran hapus" | Cache, file sementara, log, crash dump, atau folder dependency. Aman dibersihkan. |
| Tanpa warna khusus | File biasa yang bisa dihapus jika sudah tidak dibutuhkan. |

File juga dicek apakah read-only atau sedang dipakai aplikasi lain. File seperti itu otomatis berubah abu-abu saat hasil pemindaian selesai.

## Catatan keamanan

- File di `C:\Windows`, `C:\Program Files`, `C:\ProgramData`, file sistem seperti `pagefile.sys` dan `hiberfil.sys`, serta registry `NTUSER.DAT` diblokir dan tidak bisa dipilih.
- Penghapusan default memakai Recycle Bin, jadi masih bisa dipulihkan. Ruang disk baru benar-benar kosong setelah Recycle Bin dikosongkan.
- Menghapus permanen tidak bisa dibatalkan. Aplikasi menampilkan konfirmasi sebelum menghapus.
- Beberapa file butuh hak Administrator. File seperti itu akan muncul abu-abu atau gagal dihapus dengan pesan alasannya.

## Struktur

```
server.js         server HTTP + API
lib/scanner.js    pemindai disk dan pengurutan ukuran
lib/rules.js      aturan file dilindungi / hati-hati / saran hapus
lib/delete.js     penghapusan ke Recycle Bin atau permanen
lib/apps.js       daftar aplikasi terinstal dan peluncur uninstaller
lib/powershell.js pembungkus eksekusi PowerShell
public/           tampilan aplikasi
start.bat         peluncur untuk Windows
```
